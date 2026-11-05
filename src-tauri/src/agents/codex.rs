use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{
    is_injected_context,
    collapse_whitespace, earlier, excerpt, file_size, file_times, iso_now, later, parse_time,
    project_info, truncate_chars,
};

use super::ParsedSession;
use crate::scan_cache::SummaryCache;

const MAX_TEXT: usize = 120_000;
const MAX_TOOL_CONTENT: usize = 24_000;
const MAX_TOOL_DETAIL: usize = 420;

pub fn count_sessions(roots: &[PathBuf]) -> u64 {
    let mut count = 0;
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file()
                && entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            {
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
        .find(|ancestor| ancestor.file_name().and_then(|name| name.to_str()) == Some("sessions"))
        .and_then(Path::parent)
        .map(load_session_titles)
        .unwrap_or_default()
}

static CACHE: SummaryCache = SummaryCache::new();

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let titles = root.parent().map(load_session_titles).unwrap_or_default();
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file()
                || entry.path().extension().and_then(|ext| ext.to_str()) != Some("jsonl")
            {
                continue;
            }
            seen.insert(entry.path().to_path_buf());
            let summary = CACHE.get_or_parse(entry.path(), || {
                parse_file(entry.path(), false).ok().map(|parsed| parsed.summary)
            });
            // Titles live in a separate index, so apply them after the cache.
            if let Some(mut summary) = summary {
                if let Some(title) = titles.get(&summary.id) {
                    summary.title = title.clone();
                }
                sessions.push(summary);
            }
        }
    }
    CACHE.retain(&seen);
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
    model: Option<String>,
    models: HashSet<String>,
    totals: TokenTotals,
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
            model: None,
            models: HashSet::new(),
            totals: TokenTotals::new(),
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

fn parse_file(path: &Path, with_messages: bool) -> Result<ParsedSession, String> {
    let file = File::open(path).map_err(|error| format!("Could not open session: {error}"))?;
    let reader = BufReader::new(file);
    let mut builder = Builder::new();
    let fallback_id = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("session")
        .to_string();
    let mut line_index = 0usize;

    for line in reader.lines() {
        let Ok(line) = line else { continue };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        line_index += 1;
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

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
            "event_msg" => {
                if payload.get("type").and_then(Value::as_str) == Some("token_count") {
                    if let Some(total) = payload
                        .get("info")
                        .and_then(|info| info.get("total_token_usage"))
                    {
                        let input = total
                            .get("input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        let cached = total
                            .get("cached_input_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        let output = total
                            .get("output_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0);
                        // OpenAI reports cached input as a subset of input tokens.
                        let next = TokenTotals {
                            input: input.saturating_sub(cached),
                            output,
                            cache_read: cached,
                            cache_write: 0,
                        };
                        // Totals are cumulative, so the day's share is the delta.
                        let delta = TokenTotals {
                            input: next.input.saturating_sub(builder.totals.input),
                            output: next.output.saturating_sub(builder.totals.output),
                            cache_read: next.cache_read.saturating_sub(builder.totals.cache_read),
                            cache_write: 0,
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
                            delta.input,
                            delta.output,
                            delta.cache_read,
                            delta.cache_write,
                            cost,
                        );
                        builder.totals = next;
                    }
                }
            }
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
    let usage = if !builder.totals.is_zero() {
        let cost = builder.model.as_deref().and_then(|model| {
            pricing::estimate(
                model,
                builder.totals.input,
                builder.totals.output,
                builder.totals.cache_read,
                builder.totals.cache_write,
            )
        });
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
            id: builder.id.unwrap_or(fallback_id),
            agent: AgentId::Codex,
            title,
            excerpt: excerpt_text,
            project,
            project_label,
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
            usage_days: builder.usage_days.into_vec(),
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
