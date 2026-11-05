use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde_json::Value;

pub fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn iso_from_system_time(time: SystemTime) -> String {
    let stamp: DateTime<Utc> = time.into();
    stamp.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn iso_from_millis(millis: i64) -> Option<String> {
    if millis <= 0 {
        return None;
    }
    Utc.timestamp_millis_opt(millis)
        .single()
        .map(|stamp| stamp.to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// Accepts RFC 3339 strings, epoch milliseconds, epoch seconds, or numeric strings.
pub fn parse_time(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            if let Ok(stamp) = DateTime::parse_from_rfc3339(text) {
                return Some(
                    stamp
                        .with_timezone(&Utc)
                        .to_rfc3339_opts(SecondsFormat::Millis, true),
                );
            }
            if let Ok(number) = text.parse::<i64>() {
                return iso_from_number(number);
            }
            // Some agent files use "2026-11-05 10:24:00" without a timezone.
            if let Ok(stamp) = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
                return Some(
                    Utc.from_utc_datetime(&stamp)
                        .to_rfc3339_opts(SecondsFormat::Millis, true),
                );
            }
            None
        }
        Value::Number(number) => number.as_i64().and_then(iso_from_number),
        _ => None,
    }
}

fn iso_from_number(number: i64) -> Option<String> {
    if number > 10_000_000_000 {
        iso_from_millis(number)
    } else {
        iso_from_millis(number.saturating_mul(1000))
    }
}

pub fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

/// Returns (created, updated) fallbacks derived from the file timestamp.
pub fn file_times(path: &Path) -> (String, String) {
    let modified = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .map(iso_from_system_time)
        .unwrap_or_else(|_| iso_now());
    (modified.clone(), modified)
}

pub fn earlier(a: &str, b: &str) -> String {
    if a <= b {
        a.to_string()
    } else {
        b.to_string()
    }
}

pub fn later(a: &str, b: &str) -> String {
    if a >= b {
        a.to_string()
    } else {
        b.to_string()
    }
}

pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn excerpt(text: &str, max_chars: usize) -> String {
    let clean = collapse_whitespace(text);
    truncate_chars(&clean, max_chars)
}

pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

pub fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for character in text.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "workspace".to_string()
    } else {
        truncate_chars(&slug, 64).trim_end_matches('-').to_string()
    }
}

pub fn project_label(slug: &str) -> String {
    let mut label = String::new();
    for word in slug.split(['-', '_']).filter(|word| !word.is_empty()) {
        if !label.is_empty() {
            label.push(' ');
        }
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            label.extend(first.to_uppercase());
            label.push_str(chars.as_str());
        }
    }
    if label.is_empty() {
        "Unknown workspace".to_string()
    } else {
        truncate_chars(&label, 58)
    }
}

/// Derives the same lightweight project metadata shape the React UI expects.
pub fn project_info(cwd: &str, fallback: &str) -> (String, String, String, String) {
    let cleaned = cwd.trim().trim_end_matches(['/', '\\']);
    let name = if cleaned.is_empty() {
        fallback
    } else {
        cleaned
            .rsplit(['/', '\\'])
            .find(|part| !part.is_empty())
            .unwrap_or(fallback)
    };
    let slug = slugify(name);
    // An explicit project display name takes precedence over the folder name.
    // Keep the slug and path based on the folder so existing filters remain stable.
    let label = if cleaned.is_empty() {
        None
    } else {
        display_name(&Path::new(cleaned).join("package.json"))
    }
    .unwrap_or_else(|| project_label(&slug));
    let tint = tint_for(&slug);
    let icon = icon_for(&slug);
    (slug, label, tint, icon)
}

type ManifestCache = HashMap<PathBuf, (Option<(u64, Option<SystemTime>)>, Option<String>)>;

/// Many sessions share a workspace, so the `displayName` lookup is cached and
/// only re-read when the manifest's size or modification time changes.
fn display_name(manifest: &Path) -> Option<String> {
    static CACHE: OnceLock<Mutex<ManifestCache>> = OnceLock::new();
    let stamp = fs::metadata(manifest)
        .ok()
        .map(|meta| (meta.len(), meta.modified().ok()));
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((cached, name)) = entries.get(manifest) {
            if *cached == stamp {
                return name.clone();
            }
        }
    }
    let name = stamp
        .filter(|(len, _)| *len <= 128 * 1024)
        .and_then(|_| fs::read_to_string(manifest).ok())
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.get("displayName").and_then(Value::as_str).map(str::to_owned))
        .map(|name| collapse_whitespace(&name))
        .filter(|name| !name.is_empty())
        .map(|name| truncate_chars(&name, 58));
    if let Ok(mut entries) = cache.lock() {
        entries.insert(manifest.to_path_buf(), (stamp, name.clone()));
    }
    name
}

fn tint_for(slug: &str) -> String {
    const TINTS: [&str; 8] = [
        "peach", "sage", "lilac", "butter", "sky", "rose", "stone", "blue",
    ];
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in slug.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    TINTS[(hash % TINTS.len() as u64) as usize].to_string()
}

fn icon_for(slug: &str) -> String {
    let rules: [(&str, &str); 20] = [
        ("mobile", "DeviceMobile"),
        ("ios", "DeviceMobile"),
        ("app", "AppWindow"),
        ("web", "Browser"),
        ("site", "Browser"),
        ("api", "Database"),
        ("server", "Database"),
        ("backend", "Database"),
        ("core", "Database"),
        ("data", "Database"),
        ("payment", "CloudArrowUp"),
        ("billing", "Receipt"),
        ("invoice", "Receipt"),
        ("film", "FilmStrip"),
        ("video", "FilmStrip"),
        ("motion", "FilmStrip"),
        ("design", "PaintBrush"),
        ("brand", "Shapes"),
        ("book", "BookOpen"),
        ("doc", "BookOpen"),
    ];
    for (needle, icon) in rules {
        if slug.contains(needle) {
            return icon.to_string();
        }
    }
    "Folder".to_string()
}

pub fn normalize_model(value: &str) -> String {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() {
        return String::new();
    }
    let without_provider = value.rsplit('/').next().unwrap_or(&value).to_string();
    // OpenCode stores provider-prefixed IDs; Cursor may append version suffixes.
    without_provider.trim_start_matches("models/").to_string()
}

pub fn is_safe_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

/// Renders a path for display only. Operations always keep the absolute path.
pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    if let Some(home) = dirs::home_dir() {
        let home_text = home.to_string_lossy();
        if let Some(rest) = text.strip_prefix(home_text.as_ref()) {
            return format!("~{}", rest);
        }
    }
    text
}

/// Wrapper tags that agents put in user-role messages for their own setup
/// (instructions, environment, notifications). The user never typed these.
const CONTEXT_TAGS: &[&str] = &[
    "environment_context",
    "user_instructions",
    "permissions",
    "turn_aborted",
    "guardian_tool_descriptions",
    "external_codex_apps_open_page",
    "in-app-browser-context",
    "no retained transcript",
    "task-notification",
    "system-reminder",
    "user-prompt-submit-hook",
    "local-command-caveat",
    "local-command-stdout",
    "local-command-stderr",
    "command-name",
    "command-message",
    "command-args",
    "instructions",
];

const CONTEXT_PREFIXES: &[&str] = &[
    "# agents.md instructions for",
    "the following is the codex agent history",
    "caveat: the messages below were generated by the user while running local commands",
];

/// True when a user-role message was injected by the agent, not typed by the user.
pub fn is_injected_context(text: &str) -> bool {
    let start: String = text.trim_start().chars().take(120).collect::<String>().to_lowercase();
    if CONTEXT_PREFIXES.iter().any(|prefix| start.starts_with(prefix)) {
        return true;
    }
    let Some(rest) = start.strip_prefix('<') else {
        return false;
    };
    CONTEXT_TAGS.iter().any(|tag| {
        rest.strip_prefix(tag)
            .and_then(|after| after.chars().next())
            .is_some_and(|next| next == '>' || next == ' ' || next == '/' || next == '\n')
    })
}

/// The local calendar day (`YYYY-MM-DD`) of an RFC 3339 timestamp.
pub fn local_day(stamp: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(stamp)
        .ok()
        .map(|time| time.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
}

/// Accumulates usage per local day so charts can place tokens on the day they
/// were spent rather than on a session's last-updated date.
#[derive(Default)]
pub struct UsageDays {
    days: std::collections::BTreeMap<String, crate::models::DayUsage>,
}

impl UsageDays {
    /// `cost` is `None` when the model has no known price; that marks the day's
    /// cost as unknown rather than silently under-reporting it.
    pub fn add(
        &mut self,
        stamp: &str,
        input: u64,
        output: u64,
        cache_read: u64,
        cache_write: u64,
        cost: Option<f64>,
    ) {
        if input == 0 && output == 0 && cache_read == 0 && cache_write == 0 {
            return;
        }
        let Some(day) = local_day(stamp) else {
            return;
        };
        let entry = self
            .days
            .entry(day.clone())
            .or_insert_with(|| crate::models::DayUsage {
                day,
                cost: Some(0.0),
                ..Default::default()
            });
        entry.input = entry.input.saturating_add(input);
        entry.output = entry.output.saturating_add(output);
        entry.cache_read = entry.cache_read.saturating_add(cache_read);
        entry.cache_write = entry.cache_write.saturating_add(cache_write);
        entry.cost = match (entry.cost, cost) {
            (Some(total), Some(cost)) => Some(total + cost),
            _ => None,
        };
    }

    pub fn into_vec(self) -> Vec<crate::models::DayUsage> {
        self.days
            .into_values()
            .map(|mut day| {
                day.cost = day.cost.map(|cost| (cost * 10_000.0).round() / 10_000.0);
                day
            })
            .collect()
    }
}

/// Moves a file or folder to the operating system's Trash / Recycle Bin so a
/// mistaken delete can be recovered. Never falls back to a permanent delete:
/// if the Trash is unavailable the error is returned and nothing is removed.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    #[cfg(not(test))]
    {
        trash::delete(path)
            .map_err(|error| format!("Could not move {} to the Trash: {error}", display_path(path)))
    }
    // Tests must not fill the developer's real Trash with fixtures.
    #[cfg(test)]
    {
        let result = if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        result.map_err(|error| format!("Could not remove {}: {error}", display_path(path)))
    }
}
