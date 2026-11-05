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
            if entry.file_type().is_file() && is_session_file(entry.path()) {
                count += 1;
            }
        }
    }
    count
}

static CACHE: SummaryCache = SummaryCache::new();

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || !is_session_file(entry.path()) {
                continue;
            }
            seen.insert(entry.path().to_path_buf());
            let summary = CACHE.get_or_parse(entry.path(), || {
                parse_file(entry.path(), false).ok().map(|parsed| parsed.summary)
            });
            if let Some(summary) = summary {
                sessions.push(summary);
            }
        }
    }
    CACHE.retain(&seen);
    sessions
}

pub fn detail(path: &Path) -> Result<SessionDetail, String> {
    let parsed = parse_file(path, true)?;
    let duration = duration_ms(&parsed.summary.created_at, &parsed.summary.updated_at);
    Ok(SessionDetail {
        summary: parsed.summary,
        messages: parsed.messages,
        duration_ms: duration,
    })
}

pub fn is_session_file(path: &Path) -> bool {
    if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
        return false;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if file_name == "history.jsonl" || file_name.starts_with("agent-") {
        return false;
    }
    let inside_subagents = path
        .components()
        .any(|component| component.as_os_str() == "subagents");
    !inside_subagents
}

fn duration_ms(created: &str, updated: &str) -> i64 {
    let start = chrono::DateTime::parse_from_rfc3339(created).ok();
    let end = chrono::DateTime::parse_from_rfc3339(updated).ok();
    match (start, end) {
        (Some(start), Some(end)) => (end - start).num_milliseconds().max(1),
        _ => 1,
    }
}

struct Builder {
    id: Option<String>,
    cwd: Option<String>,
    branch: Option<String>,
    title: Option<String>,
    user_text: Option<String>,
    assistant_text: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: f64,
    known_cost: bool,
    unknown_cost: bool,
    usage_days: crate::util::UsageDays,
    models: HashMap<String, u64>,
    messages: Vec<Message>,
    seen_entries: HashSet<String>,
    tool_names: HashMap<String, String>,
    message_count: u64,
}

impl Builder {
    fn new() -> Self {
        Self {
            id: None,
            cwd: None,
            branch: None,
            title: None,
            user_text: None,
            assistant_text: None,
            created: None,
            updated: None,
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            cost: 0.0,
            known_cost: false,
            unknown_cost: false,
            usage_days: crate::util::UsageDays::default(),
            models: HashMap::new(),
            messages: Vec::new(),
            seen_entries: HashSet::new(),
            tool_names: HashMap::new(),
            message_count: 0,
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

    fn note_model(&mut self, model: &str) -> String {
        if model.is_empty() || model.starts_with('<') {
            return String::new();
        }
        let canonical = pricing::canonical_model(model);
        *self.models.entry(canonical.clone()).or_insert(0) += 1;
        canonical
    }

    fn push_message(&mut self, message: Message, with_messages: bool) {
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
    let fallback_cwd = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name.trim_start_matches('-').replace('-', "/"))
        .unwrap_or_else(|| "Claude workspace".to_string());

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
        if let Some(session_id) = value.get("sessionId").and_then(Value::as_str) {
            if builder.id.is_none() && !session_id.is_empty() {
                builder.id = Some(session_id.to_string());
            }
        }
        if builder.cwd.is_none() {
            builder.cwd = value
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_string);
        }
        if builder.branch.is_none() {
            builder.branch = value
                .get("gitBranch")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_string);
        }

        let entry_uuid = value
            .get("uuid")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("{fallback_id}-{line_index}"));
        if !builder.seen_entries.insert(entry_uuid.clone()) {
            continue;
        }

        let stamp = value.get("timestamp").and_then(parse_time);
        builder.touch_time(stamp.clone());
        let message_stamp =
            stamp.unwrap_or_else(|| builder.updated.clone().unwrap_or_else(iso_now));

        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "summary" => {
                if let Some(summary) = value.get("summary").and_then(Value::as_str) {
                    let summary = collapse_whitespace(summary);
                    if !summary.is_empty() {
                        builder.title = Some(summary);
                    }
                }
            }
            "user" => {
                if let Some(message) = value.get("message") {
                    parse_user_entry(
                        &mut builder,
                        message,
                        &value,
                        &entry_uuid,
                        &message_stamp,
                        with_messages,
                    );
                }
            }
            "assistant" => {
                if let Some(message) = value.get("message") {
                    parse_assistant_entry(
                        &mut builder,
                        message,
                        &entry_uuid,
                        &message_stamp,
                        with_messages,
                    );
                }
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
    let cwd = builder.cwd.clone().unwrap_or(fallback_cwd);
    let (project, project_label, tint, icon) = project_info(&cwd, "Claude Code");
    let title = builder
        .title
        .clone()
        .or_else(|| builder.user_text.as_deref().map(|text| excerpt(text, 76)))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Untitled Claude session".to_string());
    let excerpt_text = builder
        .assistant_text
        .as_deref()
        .or(builder.user_text.as_deref())
        .map(|text| excerpt(text, 168))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "A local Claude Code conversation.".to_string());
    let usage = if builder.input + builder.output + builder.cache_read + builder.cache_write > 0 {
        let cost = if builder.known_cost && !builder.unknown_cost {
            Some((builder.cost * 10_000.0).round() / 10_000.0)
        } else {
            None
        };
        Some(UsageBreakdown {
            input: builder.input,
            output: builder.output,
            cache_read: builder.cache_read,
            cache_write: builder.cache_write,
            cost,
        })
    } else {
        None
    };
    let tokens = usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0);
    let mut models: Vec<(String, u64)> = builder.models.into_iter().collect();
    models.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let model_list: Vec<String> = models.iter().map(|(model, _)| model.clone()).collect();
    let model = model_list.first().cloned();

    Ok(ParsedSession {
        summary: SessionSummary {
            id: builder.id.unwrap_or(fallback_id),
            agent: AgentId::Claude,
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
            model,
            models: model_list,
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

fn parse_user_entry(
    builder: &mut Builder,
    message: &Value,
    entry: &Value,
    entry_id: &str,
    stamp: &str,
    with_messages: bool,
) {
    let is_meta = entry
        .get("isMeta")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = message.get("content").cloned().unwrap_or(Value::Null);
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_messages: Vec<Message> = Vec::new();

    match content {
        Value::String(text) => {
            if !text.trim().is_empty() {
                text_parts.push(truncate_chars(&text, MAX_TEXT));
            }
        }
        Value::Array(blocks) => {
            for (index, block) in blocks.iter().enumerate() {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                text_parts.push(truncate_chars(text, MAX_TEXT));
                            }
                        }
                    }
                    Some("image") => text_parts.push("[image attachment]".to_string()),
                    Some("tool_result") => {
                        let result_text = content_text(block.get("content"));
                        let tool_use_id = block
                            .get("tool_use_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let tool_name = builder.tool_names.get(tool_use_id).cloned();
                        let failed = block
                            .get("is_error")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        tool_messages.push(Message {
                            id: format!("{entry_id}-result-{index}"),
                            role: "tool".to_string(),
                            content: truncate_chars(
                                if result_text.trim().is_empty() {
                                    "(No output)"
                                } else {
                                    &result_text
                                },
                                MAX_TEXT,
                            ),
                            timestamp: stamp.to_string(),
                            model: None,
                            tool_name,
                            tool_detail: Some(if failed {
                                "Tool call failed".to_string()
                            } else {
                                "Tool call completed".to_string()
                            }),
                            tool_status: Some(if failed { "error" } else { "ok" }.to_string()),
                            tokens: None,
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }

    if !is_meta && !text_parts.is_empty() {
        let text = text_parts.join("\n\n");
        let injected = is_injected_context(&text);
        if builder.user_text.is_none() && !injected && !text.trim_start().starts_with('<') {
            builder.user_text = Some(text.clone());
        }
        builder.push_message(
            Message {
                id: entry_id.to_string(),
                role: if injected { "system" } else { "user" }.to_string(),
                content: truncate_chars(&text, MAX_TEXT),
                timestamp: stamp.to_string(),
                model: None,
                tool_name: None,
                tool_detail: None,
                tool_status: None,
                tokens: None,
            },
            with_messages,
        );
    }

    for message in tool_messages {
        builder.push_message(message, with_messages);
    }
}

fn parse_assistant_entry(
    builder: &mut Builder,
    message: &Value,
    entry_id: &str,
    stamp: &str,
    with_messages: bool,
) {
    let raw_model = message
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let model = builder.note_model(raw_model);
    let usage = message.get("usage");
    let mut message_tokens = 0u64;
    if let Some(usage) = usage {
        let input = usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let output = usage
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let cache_write = usage
            .get("cache_creation_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        builder.input = builder.input.saturating_add(input);
        builder.output = builder.output.saturating_add(output);
        builder.cache_read = builder.cache_read.saturating_add(cache_read);
        builder.cache_write = builder.cache_write.saturating_add(cache_write);
        message_tokens = input
            .saturating_add(output)
            .saturating_add(cache_read)
            .saturating_add(cache_write);
        if message_tokens > 0 {
            let cost = pricing::estimate(&model, input, output, cache_read, cache_write);
            if let Some(cost) = cost {
                builder.cost += cost;
                builder.known_cost = true;
            } else {
                builder.unknown_cost = true;
            }
            builder
                .usage_days
                .add(stamp, input, output, cache_read, cache_write, cost);
        }
    }

    let content = message.get("content").cloned().unwrap_or(Value::Null);
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_messages: Vec<Message> = Vec::new();

    match content {
        Value::String(text) => {
            if !text.trim().is_empty() {
                text_parts.push(truncate_chars(&text, MAX_TEXT));
            }
        }
        Value::Array(blocks) => {
            for (index, block) in blocks.iter().enumerate() {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            if !text.trim().is_empty() {
                                text_parts.push(truncate_chars(text, MAX_TEXT));
                            }
                        }
                    }
                    Some("tool_use") => {
                        let tool_id = block.get("id").and_then(Value::as_str).unwrap_or_default();
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("Tool");
                        if !tool_id.is_empty() {
                            builder
                                .tool_names
                                .insert(tool_id.to_string(), name.to_string());
                        }
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        let detail = compact_input(&input);
                        let body =
                            serde_json::to_string_pretty(&input).unwrap_or_else(|_| detail.clone());
                        tool_messages.push(Message {
                            id: format!("{entry_id}-tool-{index}"),
                            role: "tool".to_string(),
                            content: truncate_chars(&body, MAX_TOOL_CONTENT),
                            timestamp: stamp.to_string(),
                            model: if model.is_empty() {
                                None
                            } else {
                                Some(model.clone())
                            },
                            tool_name: Some(name.to_string()),
                            tool_detail: Some(detail),
                            tool_status: Some("ok".to_string()),
                            tokens: None,
                        });
                    }
                    Some("image") => text_parts.push("[image]".to_string()),
                    _ => {}
                }
            }
        }
        _ => {}
    }

    if !text_parts.is_empty() {
        let text = text_parts.join("\n\n");
        if builder.assistant_text.is_none() && !text.trim_start().starts_with('<') {
            builder.assistant_text = Some(text.clone());
        }
        builder.push_message(
            Message {
                id: entry_id.to_string(),
                role: "assistant".to_string(),
                content: truncate_chars(&text, MAX_TEXT),
                timestamp: stamp.to_string(),
                model: if model.is_empty() {
                    None
                } else {
                    Some(model.clone())
                },
                tool_name: None,
                tool_detail: None,
                tool_status: None,
                tokens: (message_tokens > 0).then_some(message_tokens),
            },
            with_messages,
        );
    }

    for message in tool_messages {
        builder.push_message(message, with_messages);
    }
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item.get("type").and_then(Value::as_str) {
                Some("text") => item.get("text").and_then(Value::as_str).map(str::to_string),
                Some("image") => Some("[image attachment]".to_string()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
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
        other => excerpt(&other.to_string(), MAX_TOOL_DETAIL),
    };
    truncate_chars(&text, MAX_TOOL_DETAIL)
}
