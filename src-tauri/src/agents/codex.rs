use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use walkdir::WalkDir;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{
    collapse_whitespace, earlier, excerpt, file_size, file_times, is_injected_context, iso_now,
    later, parse_time, project_info, truncate_chars,
};

use super::ParsedSession;
use crate::scan_cache::SummaryCache;

const MAX_TEXT: usize = 120_000;
const MAX_TOOL_CONTENT: usize = 24_000;
const MAX_TOOL_DETAIL: usize = 420;
const LARGE_LINE_THRESHOLD: usize = 64 * 1024;
const MAX_RETAINED_LINE_BYTES: usize = 1024 * 1024;

/// Codex stores recent rollouts as `.jsonl` and compresses older or archived
/// rollouts in place as `.jsonl.zst`.
pub fn is_rollout_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
}

fn is_zstd_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".jsonl.zst"))
}

fn open_rollout_reader(path: &Path) -> Result<Box<dyn BufRead>, String> {
    let file = File::open(path).map_err(|error| format!("Could not open session: {error}"))?;
    if is_zstd_file(path) {
        let decoder = zstd::stream::read::Decoder::new(BufReader::with_capacity(64 * 1024, file))
            .map_err(|error| format!("Could not decompress session: {error}"))?;
        Ok(Box::new(BufReader::with_capacity(128 * 1024, decoder)))
    } else {
        Ok(Box::new(BufReader::with_capacity(128 * 1024, file)))
    }
}

pub fn count_sessions(roots: &[PathBuf]) -> u64 {
    let mut count = 0;
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file() && is_rollout_file(entry.path()) {
                count += 1;
            }
        }
    }
    count
}

// Codex stores user-visible chat titles separately from the rollout files.
// The index is optional, append-only, and is read without modifying Codex data.
fn load_session_titles(home: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(home.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    let mut titles = HashMap::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = record.get("id").and_then(Value::as_str) else { continue };
        let Some(title) = record.get("thread_name").and_then(Value::as_str) else { continue };
        let title = collapse_whitespace(title);
        if !id.is_empty() && !title.is_empty() {
            titles.insert(id.to_string(), truncate_chars(&title, 200));
        }
    }
    titles
}

fn index_for_session(path: &Path) -> HashMap<String, String> {
    path.ancestors()
        .find(|ancestor| {
            matches!(
                ancestor.file_name().and_then(|name| name.to_str()),
                Some("sessions" | "archived_sessions")
            )
        })
        .and_then(Path::parent)
        .map(load_session_titles)
        .unwrap_or_default()
}

static CACHE: SummaryCache = SummaryCache::new("codex");

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    let mut title_maps: Vec<HashMap<String, String>> = Vec::with_capacity(roots.len());
    let mut files: Vec<(PathBuf, usize, u64)> = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        let map_index = title_maps.len();
        title_maps.push(root.parent().map(load_session_titles).unwrap_or_default());
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || !is_rollout_file(entry.path()) {
                continue;
            }
            let path = entry.path().to_path_buf();
            if seen.insert(path.clone()) {
                let len = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                files.push((path, map_index, len));
            }
        }
    }

    // Start the largest rollouts first so work-stealing keeps all threads busy
    // on a cold scan of compressed history.
    files.sort_by(|a, b| b.2.cmp(&a.2));

    let parse_one = |(path, map_index, _): &(PathBuf, usize, u64)| -> Option<SessionSummary> {
        let mut summary = CACHE.get_or_parse(path, || {
            parse_file(path, false).ok().map(|parsed| parsed.summary)
        })?;
        // Titles live in a separate index, so apply them after the cache.
        if let Some(title) = title_maps[*map_index].get(&summary.id) {
            summary.title = title.clone();
        }
        Some(summary)
    };

    let sessions = if files.len() <= 4 {
        files.iter().filter_map(parse_one).collect()
    } else {
        let workers = std::thread::available_parallelism()
            .map(|count| count.get().min(8))
            .unwrap_or(4)
            .min(files.len());
        let cursor = AtomicUsize::new(0);
        let mut results: Vec<Vec<SessionSummary>> = Vec::with_capacity(workers);
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..workers)
                .map(|_| {
                    let files_ref = &files;
                    let cursor_ref = &cursor;
                    let parse_ref = &parse_one;
                    scope.spawn(move || {
                        let mut local = Vec::new();
                        loop {
                            let idx = cursor_ref.fetch_add(1, Ordering::Relaxed);
                            let Some(item) = files_ref.get(idx) else {
                                break;
                            };
                            if let Some(summary) = parse_ref(item) {
                                local.push(summary);
                            }
                        }
                        local
                    })
                })
                .collect();
            for handle in handles {
                if let Ok(local) = handle.join() {
                    results.push(local);
                }
            }
        });
        results.into_iter().flatten().collect()
    };

    CACHE.finish_scan(&seen);
    sessions
}

pub fn detail(path: &Path) -> Result<SessionDetail, String> {
    let mut parsed = parse_file(path, true)?;
    if let Some(title) = index_for_session(path).get(&parsed.summary.id) {
        parsed.summary.title = title.clone();
    }
    let duration = duration_ms(&parsed.summary.created_at, &parsed.summary.updated_at);
    Ok(SessionDetail {
        summary: parsed.summary,
        messages: parsed.messages,
        duration_ms: duration,
    })
}

fn duration_ms(created: &str, updated: &str) -> i64 {
    let start = chrono::DateTime::parse_from_rfc3339(created).ok();
    let end = chrono::DateTime::parse_from_rfc3339(updated).ok();
    match (start, end) {
        (Some(start), Some(end)) => (end - start).num_milliseconds().max(1),
        _ => 1,
    }
}

struct TokenTotals {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

impl TokenTotals {
    fn new() -> Self {
        Self {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
        }
    }

    fn is_zero(&self) -> bool {
        self.input == 0 && self.output == 0 && self.cache_read == 0 && self.cache_write == 0
    }
}

struct Builder {
    id: Option<String>,
    cwd: Option<String>,
    branch: Option<String>,
    user_text: Option<String>,
    assistant_text: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    first_model: Option<String>,
    model: Option<String>,
    models: HashSet<String>,
    totals: TokenTotals,
    prev_cumulative: TokenTotals,
    prev_raw_input: u64,
    usage_days: crate::util::UsageDays,
    messages: Vec<Message>,
    message_count: u64,
    tool_names: HashMap<String, String>,
}

impl Builder {
    fn new() -> Self {
        Self {
            id: None,
            cwd: None,
            branch: None,
            user_text: None,
            assistant_text: None,
            created: None,
            updated: None,
            first_model: None,
            model: None,
            models: HashSet::new(),
            totals: TokenTotals::new(),
            prev_cumulative: TokenTotals::new(),
            prev_raw_input: 0,
            usage_days: crate::util::UsageDays::default(),
            messages: Vec::new(),
            message_count: 0,
            tool_names: HashMap::new(),
        }
    }

    fn touch_time(&mut self, stamp: Option<String>) {
        if let Some(stamp) = stamp {
            self.created = Some(match self.created.take() {
                Some(current) => earlier(&current, &stamp),
                None => stamp.clone(),
            });
            self.updated = Some(match self.updated.take() {
                Some(current) => later(&current, &stamp),
                None => stamp,
            });
        }
    }

    fn note_model(&mut self, raw: &str) {
        if raw.trim().is_empty() {
            return;
        }
        let canonical = pricing::canonical_model(raw);
        if self.first_model.is_none() {
            self.first_model = Some(canonical.clone());
            self.usage_days
                .attribute_unassigned(&canonical, pricing::estimate);
        }
        self.models.insert(canonical.clone());
        self.model = Some(canonical);
    }

    fn push(&mut self, message: Message, with_messages: bool) {
        self.message_count = self.message_count.saturating_add(1);
        if with_messages {
            self.messages.push(message);
        }
    }
}

fn prefix_utf8(text: &str, max_bytes: usize) -> &str {
    let mut end = max_bytes.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn extract_json_str<'a>(haystack: &'a str, key_pat: &str) -> Option<&'a str> {
    let start = haystack.find(key_pat)? + key_pat.len();
    let rest = &haystack[start..];
    let end = rest.find('"')?;
    let value = &rest[..end];
    (!value.contains('\\')).then_some(value)
}

fn parse_rfc3339_utc(text: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(text.trim()).ok().map(|time| {
        time.with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Millis, true)
    })
}

/// Fast path for huge summary-only lines (typically multi-megabyte base64
/// attachments, tool outputs, or compaction blobs). Falls back to full JSON
/// parsing whenever the prefix does not match unambiguously.
fn try_fast_skip_large_line(
    line: &str,
    builder: &mut Builder,
    timing: &mut crate::timing::Collector,
) -> bool {
    let prefix = prefix_utf8(line, 1024);
    let Some(payload_pos) = prefix.find("\"payload\":{") else {
        return false;
    };
    let head = &prefix[..payload_pos];
    let Some(raw_ts) = extract_json_str(head, "\"timestamp\":\"") else {
        return false;
    };
    let Some(stamp) = parse_rfc3339_utc(raw_ts) else {
        return false;
    };
    let Some(kind) = extract_json_str(head, "\"type\":\"") else {
        return false;
    };
    let payload_prefix = &prefix[payload_pos..];

    match kind {
        "compacted" => {
            builder.touch_time(Some(stamp));
            true
        }
        "event_msg" => match extract_json_str(payload_prefix, "\"type\":\"") {
            Some("item_completed") => {
                builder.touch_time(Some(stamp.clone()));
                timing.activity_iso(&stamp);
                true
            }
            _ => false,
        },
        "response_item" => match extract_json_str(payload_prefix, "\"type\":\"") {
            Some(
                "function_call"
                | "custom_tool_call"
                | "function_call_output"
                | "custom_tool_call_output",
            ) => {
                builder.touch_time(Some(stamp.clone()));
                timing.activity_iso(&stamp);
                builder.message_count = builder.message_count.saturating_add(1);
                true
            }
            Some("reasoning") => {
                builder.touch_time(Some(stamp.clone()));
                timing.activity_iso(&stamp);
                true
            }
            Some("compaction" | "additional_tools") => {
                builder.touch_time(Some(stamp));
                true
            }
            Some("message") if builder.user_text.is_some() && builder.assistant_text.is_some() => {
                match extract_json_str(payload_prefix, "\"role\":\"") {
                    Some("developer" | "system") => {
                        builder.touch_time(Some(stamp));
                        true
                    }
                    Some("assistant") => {
                        builder.touch_time(Some(stamp.clone()));
                        timing.activity_iso(&stamp);
                        builder.message_count = builder.message_count.saturating_add(1);
                        true
                    }
                    Some("user") => {
                        let has_image = payload_prefix.contains("\"input_image\"")
                            || payload_prefix.contains("\"type\":\"image\"");
                        let genuine_text = payload_prefix.find("\"text\":\"").is_some_and(|pos| {
                            let rest = &payload_prefix[pos + 8..];
                            let trimmed = rest.trim_start();
                            !trimmed.is_empty()
                                && !trimmed.starts_with('"')
                                && !trimmed.starts_with('\\')
                                && !is_injected_context(trimmed)
                        });
                        if has_image || genuine_text {
                            builder.touch_time(Some(stamp.clone()));
                            timing.activity_iso(&stamp);
                            builder.message_count = builder.message_count.saturating_add(1);
                            true
                        } else {
                            false
                        }
                    }
                    _ => false,
                }
            }
            _ => false,
        },
        _ => false,
    }
}

fn parse_file(path: &Path, with_messages: bool) -> Result<ParsedSession, String> {
    let mut reader = open_rollout_reader(path)?;
    let mut builder = Builder::new();
    let mut timing = crate::timing::Collector::default();
    let fallback_id = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            name.strip_suffix(".jsonl.zst")
                .or_else(|| name.strip_suffix(".jsonl"))
                .unwrap_or(name)
        })
        .unwrap_or("session")
        .to_string();
    let mut line_index = 0usize;
    let mut raw_line = Vec::with_capacity(4096);

    loop {
        raw_line.clear();
        let read = match reader.read_until(b'\n', &mut raw_line) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        if read == 0 {
            break;
        }
        let decoded = String::from_utf8_lossy(&raw_line);
        let line = decoded.trim();
        if line.is_empty() {
            if raw_line.capacity() > MAX_RETAINED_LINE_BYTES {
                raw_line = Vec::with_capacity(4096);
            }
            continue;
        }
        line_index += 1;

        if !with_messages
            && line.len() > LARGE_LINE_THRESHOLD
            && try_fast_skip_large_line(line, &mut builder, &mut timing)
        {
            if raw_line.capacity() > MAX_RETAINED_LINE_BYTES {
                raw_line = Vec::with_capacity(4096);
            }
            continue;
        }

        let Ok(value) = serde_json::from_str::<Value>(line) else {
            if raw_line.capacity() > MAX_RETAINED_LINE_BYTES {
                raw_line = Vec::with_capacity(4096);
            }
            continue;
        };

        timing.codex(&value);
        let stamp = value.get("timestamp").and_then(parse_time).or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("timestamp"))
                .and_then(parse_time)
        });
        builder.touch_time(stamp.clone());
        let message_stamp =
            stamp.unwrap_or_else(|| builder.updated.clone().unwrap_or_else(iso_now));
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = value.get("payload").cloned().unwrap_or(Value::Null);

        match kind {
            "session_meta" => {
                if let Some(id) = payload.get("id").and_then(Value::as_str) {
                    if !id.trim().is_empty() {
                        builder.id = Some(id.to_string());
                    }
                }
                if builder.cwd.is_none() {
                    builder.cwd = payload
                        .get("cwd")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_string);
                }
                if builder.branch.is_none() {
                    builder.branch = payload
                        .get("git")
                        .and_then(|git| git.get("branch"))
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_string);
                }
                if let Some(model) = payload.get("model").and_then(Value::as_str) {
                    builder.note_model(model);
                }
                if let Some(model) = payload
                    .get("meta")
                    .and_then(|meta| meta.get("model"))
                    .and_then(Value::as_str)
                {
                    builder.note_model(model);
                }
            }
            "turn_context" => {
                if let Some(model) = payload.get("model").and_then(Value::as_str) {
                    builder.note_model(model);
                }
                if builder.cwd.is_none() {
                    builder.cwd = payload
                        .get("cwd")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_string);
                }
            }
            "world_state" => {
                if let Some(model) = payload
                    .get("state")
                    .and_then(|state| state.get("collaboration_mode"))
                    .and_then(|mode| mode.get("model"))
                    .and_then(Value::as_str)
                {
                    builder.note_model(model);
                }
            }
            "event_msg" => match payload.get("type").and_then(Value::as_str) {
                Some("thread_settings_applied") => {
                    if let Some(model) = payload
                        .get("thread_settings")
                        .and_then(|settings| settings.get("model"))
                        .and_then(Value::as_str)
                    {
                        builder.note_model(model);
                    }
                }
                Some("token_count") => {
                    if let Some(total) = payload
                        .get("info")
                        .and_then(|info| info.get("total_token_usage"))
                    {
                        let raw_input = total
                            .get("input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        let cached = total
                            .get("cached_input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        let cache_write = total
                            .get("cache_write_input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        let output = total
                            .get("output_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        // OpenAI reports cached input as a subset of input tokens.
                        let next = TokenTotals {
                            input: raw_input.saturating_sub(cached),
                            output,
                            cache_read: cached,
                            cache_write,
                        };
                        // Totals are cumulative within a run, but Codex resets
                        // total_token_usage to 0 when a session is resumed.
                        let reset = raw_input < builder.prev_raw_input
                            || output < builder.prev_cumulative.output
                            || cached < builder.prev_cumulative.cache_read
                            || cache_write < builder.prev_cumulative.cache_write;
                        let delta = if reset {
                            TokenTotals {
                                input: next.input,
                                output: next.output,
                                cache_read: next.cache_read,
                                cache_write: next.cache_write,
                            }
                        } else {
                            TokenTotals {
                                input: next.input.saturating_sub(builder.prev_cumulative.input),
                                output: next.output.saturating_sub(builder.prev_cumulative.output),
                                cache_read: next
                                    .cache_read
                                    .saturating_sub(builder.prev_cumulative.cache_read),
                                cache_write: next
                                    .cache_write
                                    .saturating_sub(builder.prev_cumulative.cache_write),
                            }
                        };
                        let cost = builder.model.as_deref().and_then(|model| {
                            pricing::estimate(
                                model,
                                delta.input,
                                delta.output,
                                delta.cache_read,
                                delta.cache_write,
                            )
                        });
                        builder.usage_days.add(
                            &message_stamp,
                            builder.model.as_deref(),
                            delta.input,
                            delta.output,
                            delta.cache_read,
                            delta.cache_write,
                            cost,
                        );
                        builder.totals.input = builder.totals.input.saturating_add(delta.input);
                        builder.totals.output = builder.totals.output.saturating_add(delta.output);
                        builder.totals.cache_read =
                            builder.totals.cache_read.saturating_add(delta.cache_read);
                        builder.totals.cache_write =
                            builder.totals.cache_write.saturating_add(delta.cache_write);
                        builder.prev_cumulative = next;
                        builder.prev_raw_input = raw_input;
                    }
                }
                _ => {}
            },
            "response_item" => {
                parse_response_item(
                    &mut builder,
                    &payload,
                    &format!("{fallback_id}-{line_index}"),
                    &message_stamp,
                    with_messages,
                );
            }
            _ => {}
        }

        if raw_line.capacity() > MAX_RETAINED_LINE_BYTES {
            raw_line = Vec::with_capacity(4096);
        }
    }

    let (file_created, file_updated) = file_times(path);
    let created_at = builder.created.clone().unwrap_or(file_created);
    let updated_at = builder.updated.clone().unwrap_or_else(|| {
        if builder.created.is_some() {
            created_at.clone()
        } else {
            file_updated
        }
    });
    let cwd = builder
        .cwd
        .clone()
        .unwrap_or_else(|| "Codex workspace".to_string());
    let (project, project_label, tint, icon) = project_info(&cwd, "Codex");
    let title = builder
        .user_text
        .as_deref()
        .map(|text| excerpt(text, 76))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Untitled Codex session".to_string());
    let excerpt_text = builder
        .assistant_text
        .as_deref()
        .or(builder.user_text.as_deref())
        .map(|text| excerpt(text, 168))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "A local Codex conversation.".to_string());
    let usage_cost = builder.usage_days.total_cost();
    let usage_days = builder.usage_days.into_vec();
    let usage = if !builder.totals.is_zero() {
        let cost = if !usage_days.is_empty() {
            usage_cost
        } else {
            builder.model.as_deref().and_then(|model| {
                pricing::estimate(
                    model,
                    builder.totals.input,
                    builder.totals.output,
                    builder.totals.cache_read,
                    builder.totals.cache_write,
                )
            })
        };
        Some(UsageBreakdown {
            input: builder.totals.input,
            output: builder.totals.output,
            cache_read: builder.totals.cache_read,
            cache_write: builder.totals.cache_write,
            cost,
        })
    } else {
        None
    };
    let tokens = usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0);
    let primary_model = builder.model.clone();
    let mut models: Vec<String> = builder.models.into_iter().collect();
    models.sort();
    if let Some(model) = &primary_model {
        models.retain(|item| item != model);
        models.insert(0, model.clone());
    }
    Ok(ParsedSession {
        summary: SessionSummary {
            timing: timing.finish(),
            id: builder.id.unwrap_or(fallback_id),
            agent: AgentId::Codex,
            title,
            excerpt: excerpt_text,
            project,
            project_label,
            project_root: String::new(),
            project_root_label: String::new(),
            cwd: crate::util::display_path(Path::new(&cwd)),
            branch: builder.branch,
            created_at,
            updated_at,
            message_count: builder.message_count,
            tokens,
            size_bytes: file_size(path),
            model: primary_model,
            models,
            usage,
            usage_days,
            model_usage: Vec::new(),
            format: "jsonl".to_string(),
            path: path.to_string_lossy().to_string(),
            deletable: true,
            tint,
            icon,
        },
        messages: builder.messages,
    })
}

fn parse_response_item(
    builder: &mut Builder,
    payload: &Value,
    entry_id: &str,
    stamp: &str,
    with_messages: bool,
) {
    let item_type = payload.get("type").and_then(Value::as_str).unwrap_or("");
    match item_type {
        "message" => {
            let role = payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user");
            if role != "user" && role != "assistant" {
                return;
            }
            let text = content_text(payload.get("content"));
            let text = if role == "user" { tidy_user_text(&text) } else { text };
            let text = text.trim();
            if text.is_empty() {
                return;
            }
            let injected = role == "user" && is_injected_context(text);
            if role == "user" && builder.user_text.is_none() && !injected {
                builder.user_text = Some(text.to_string());
            }
            if role == "assistant" && builder.assistant_text.is_none() {
                builder.assistant_text = Some(text.to_string());
            }
            builder.push(
                Message {
                    id: entry_id.to_string(),
                    role: if injected { "system" } else { role }.to_string(),
                    content: truncate_chars(text, MAX_TEXT),
                    timestamp: stamp.to_string(),
                    model: builder.model.clone(),
                    tool_name: None,
                    tool_detail: None,
                    tool_status: None,
                    tokens: None,
                },
                with_messages,
            );
        }
        "function_call" | "custom_tool_call" => {
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Tool");
            let call_id = payload
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !call_id.is_empty() {
                builder
                    .tool_names
                    .insert(call_id.to_string(), name.to_string());
            }
            let arguments = payload
                .get("arguments")
                .or_else(|| payload.get("input"))
                .cloned()
                .unwrap_or(Value::Null);
            let detail = compact_input(&arguments);
            let body = match &arguments {
                Value::String(text) => text.clone(),
                other => serde_json::to_string_pretty(other).unwrap_or_else(|_| detail.clone()),
            };
            builder.push(
                Message {
                    id: format!("{entry_id}-tool"),
                    role: "tool".to_string(),
                    content: truncate_chars(&body, MAX_TOOL_CONTENT),
                    timestamp: stamp.to_string(),
                    model: builder.model.clone(),
                    tool_name: Some(name.to_string()),
                    tool_detail: Some(detail),
                    tool_status: Some("ok".to_string()),
                    tokens: None,
                },
                with_messages,
            );
        }
        "function_call_output" | "custom_tool_call_output" => {
            let call_id = payload
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let name = builder.tool_names.get(call_id).cloned();
            let output = payload
                .get("output")
                .map(|value| match value {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                })
                .unwrap_or_default();
            let failed = output.contains("\"success\":false")
                || output.contains("Process exited with code 1")
                || output.contains("Process exited with code 2");
            builder.push(
                Message {
                    id: format!("{entry_id}-result"),
                    role: "tool".to_string(),
                    content: truncate_chars(
                        if output.trim().is_empty() {
                            "(No output)"
                        } else {
                            &output
                        },
                        MAX_TEXT,
                    ),
                    timestamp: stamp.to_string(),
                    model: builder.model.clone(),
                    tool_name: name,
                    tool_detail: Some(if failed {
                        "Tool call failed".to_string()
                    } else {
                        "Tool call completed".to_string()
                    }),
                    tool_status: Some(if failed { "error" } else { "ok" }.to_string()),
                    tokens: None,
                },
                with_messages,
            );
        }
        _ => {}
    }
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => {
            // Codex wraps each pasted image as `<image name=[Image #1] path="…">`,
            // the image itself, then `</image>`. Show that as one "[Image #1]".
            let mut parts = Vec::new();
            let mut labelled_image = false;
            for item in items {
                match item.get("type").and_then(Value::as_str) {
                    Some("input_text") | Some("output_text") | Some("text") => {
                        let Some(text) = item.get("text").and_then(Value::as_str) else {
                            continue;
                        };
                        let trimmed = text.trim();
                        if trimmed == "</image>" {
                            continue;
                        }
                        if let Some(label) = image_tag_label(trimmed) {
                            parts.push(label);
                            labelled_image = true;
                            continue;
                        }
                        parts.push(text.to_string());
                    }
                    Some("input_image") | Some("image") => {
                        if !std::mem::take(&mut labelled_image) {
                            parts.push("[Image]".to_string());
                        }
                    }
                    _ => {}
                }
            }
            parts.join("\n")
        }
        _ => String::new(),
    }
}

const FILES_HEADER: &str = "# Files mentioned by the user:";

/// Codex puts attachments ahead of the user's words: a "Files mentioned"
/// header, one `## name: path` heading per file, its own reminder lines, then
/// `## My request…:` and the text the user typed. Keep the file names on one
/// line and the request as written.
fn tidy_user_text(text: &str) -> String {
    let trimmed = text.trim_start();
    let Some(rest) = trimmed.strip_prefix(FILES_HEADER) else {
        return text.to_string();
    };
    let mut files = Vec::new();
    let mut extras = Vec::new();
    let mut request = None;
    let mut lines = rest.lines();
    while let Some(line) = lines.next() {
        let line = line.trim();
        if let Some(heading) = line.strip_prefix("## ") {
            if heading.to_lowercase().starts_with("my request") {
                request = Some(lines.by_ref().collect::<Vec<_>>().join("\n"));
                break;
            }
            let name = heading.split(": /").next().unwrap_or(heading).trim();
            if !name.is_empty() {
                files.push(name.to_string());
            }
        } else if line.starts_with("[Image") {
            extras.push(line.to_string());
        }
    }
    let mut parts = Vec::new();
    if !files.is_empty() {
        parts.push(format!("Attached: {}", files.join(", ")));
    }
    if let Some(request) = request {
        parts.push(request.trim().to_string());
    } else {
        parts.extend(extras);
    }
    parts.join("\n\n")
}

/// `<image name=[Image #1] path="…">` → `[Image #1]`.
fn image_tag_label(text: &str) -> Option<String> {
    let rest = text.strip_prefix("<image name=")?;
    let end = rest.find(" path=").or_else(|| rest.find('>'))?;
    let name = rest[..end].trim().trim_matches('"');
    Some(if name.starts_with('[') { name.to_string() } else { format!("[{name}]") })
}

fn compact_input(input: &Value) -> String {
    let text = match input {
        Value::Object(map) => map
            .iter()
            .take(3)
            .map(|(key, value)| match value {
                Value::String(text) => format!("{key}={}", excerpt(text, 60)),
                other => format!("{key}={}", excerpt(&other.to_string(), 60)),
            })
            .collect::<Vec<_>>()
            .join(" · "),
        Value::String(text) => excerpt(text, MAX_TOOL_DETAIL),
        other => excerpt(&other.to_string(), MAX_TOOL_DETAIL),
    };
    truncate_chars(&collapse_whitespace(&text), MAX_TOOL_DETAIL)
}
