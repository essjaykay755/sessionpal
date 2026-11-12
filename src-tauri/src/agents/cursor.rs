use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde_json::Value;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{earlier, excerpt, file_times, later, parse_time, project_info, truncate_chars};

use super::ParsedSession;
use crate::scan_cache::{sqlite_files, SummaryCache};

const MAX_TEXT: usize = 120_000;
const MAX_TOOL_CONTENT: usize = 24_000;
const MAX_TOOL_DETAIL: usize = 420;

fn open_read_only(path: &Path) -> Result<Connection, String> {
    super::sqlite::open_read_only(path, "Cursor")
}

fn has_table(connection: &Connection) -> bool {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false)
}

pub fn count_sessions(roots: &[PathBuf]) -> u64 {
    let mut count = 0;
    for db in roots {
        let Ok(connection) = open_read_only(db) else {
            continue;
        };
        if !has_table(&connection) {
            continue;
        }
        let value: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count += value.max(0) as u64;
    }
    count
}

static CACHE: SummaryCache = SummaryCache::new("cursor");

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for db in roots {
        seen.insert(db.clone());
        sessions.extend(CACHE.get_or_scan(db, &sqlite_files(db), || scan_db(db)));
    }
    CACHE.finish_scan(&seen);
    sessions
}

fn scan_db(db: &Path) -> Vec<SessionSummary> {
    let mut sessions = Vec::new();
    let Ok(connection) = open_read_only(db) else {
        return sessions;
    };
    if !has_table(&connection) {
        return sessions;
    }
    let Ok(mut statement) = connection
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
    else {
        return sessions;
    };
    let rows = statement.query_map([], |row| {
        let key: String = row.get(0)?;
        Ok((key, read_value(row.get_ref(1)?)))
    });
    let Ok(rows) = rows else {
        return sessions;
    };
    for row in rows.flatten() {
        let (key, raw) = row;
        let Ok(composer) = serde_json::from_slice::<Value>(&raw) else {
            continue;
        };
        if let Ok(parsed) = parse_composer(db, &key, &composer, Some(&connection), false) {
            if parsed.summary.message_count > 0 || !parsed.summary.title.starts_with("Untitled") {
                sessions.push(parsed.summary);
            }
        }
    }
    sessions
}

pub fn detail(db: &Path, session_id: &str) -> Result<SessionDetail, String> {
    let connection = open_read_only(db)?;
    if !has_table(&connection) {
        return Err("The Cursor database does not contain cursorDiskKV.".to_string());
    }
    let key = format!("composerData:{session_id}");
    let mut statement = connection
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key = ?1")
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([&key]).map_err(|error| error.to_string())?;
    let Some(row) = rows.next().map_err(|error| error.to_string())? else {
        return Err("That Cursor composer no longer exists in the database.".to_string());
    };
    let raw = read_value(row.get_ref(1).map_err(|error| error.to_string())?);
    let composer: Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Could not parse the Cursor composer: {error}"))?;
    let parsed = parse_composer(db, &key, &composer, Some(&connection), true)?;
    let duration = duration_ms(&parsed.summary.created_at, &parsed.summary.updated_at);
    Ok(SessionDetail {
        summary: parsed.summary,
        messages: parsed.messages,
        duration_ms: duration,
    })
}

fn read_value(value: ValueRef<'_>) -> Vec<u8> {
    match value {
        ValueRef::Text(text) => text.to_vec(),
        ValueRef::Blob(blob) => blob.to_vec(),
        _ => Vec::new(),
    }
}

fn duration_ms(created: &str, updated: &str) -> i64 {
    let start = chrono::DateTime::parse_from_rfc3339(created).ok();
    let end = chrono::DateTime::parse_from_rfc3339(updated).ok();
    match (start, end) {
        (Some(start), Some(end)) => (end - start).num_milliseconds().max(1),
        _ => 1,
    }
}

struct Bubble {
    id: String,
    role: String,
    text: String,
    timestamp: String,
    genuine_timestamp: Option<String>,
    model: Option<String>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    tool_name: Option<String>,
    tool_detail: Option<String>,
    tool_content: Option<String>,
    tool_status: Option<String>,
}

impl Bubble {
    fn tokens(&self) -> u64 {
        self.input
            .saturating_add(self.output)
            .saturating_add(self.cache_read)
            .saturating_add(self.cache_write)
    }
}

fn parse_composer(
    db: &Path,
    key: &str,
    composer: &Value,
    connection: Option<&Connection>,
    with_messages: bool,
) -> Result<ParsedSession, String> {
    let fallback_id = key.strip_prefix("composerData:").unwrap_or(key).to_string();
    let id = composer
        .get("composerId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&fallback_id)
        .to_string();
    let workspace_uri = workspace_uri(composer);
    let workspace_name = composer
        .get("workspaceIdentifier")
        .and_then(|workspace| workspace.get("name"))
        .and_then(Value::as_str)
        .or_else(|| composer.get("workspaceName").and_then(Value::as_str))
        .map(str::to_string);
    let cwd = workspace_uri
        .as_deref()
        .map(file_uri_to_path)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            ["cwd", "workspacePath"].iter().find_map(|key| {
                composer
                    .get(*key)
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        })
        .or(workspace_name.clone())
        .unwrap_or_else(|| "Cursor workspace".to_string());
    let (project, project_label, tint, icon) = project_info(&cwd, "Cursor");
    let (file_created, file_updated) = file_times(db);

    let created = composer
        .get("createdAt")
        .and_then(parse_time)
        .unwrap_or_else(|| file_created.clone());
    let updated = composer
        .get("lastUpdatedAt")
        .and_then(parse_time)
        .or_else(|| composer.get("updatedAt").and_then(parse_time))
        .unwrap_or_else(|| file_updated.clone());
    let base_model = composer
        .get("modelConfig")
        .and_then(|config| {
            config
                .get("modelName")
                .or_else(|| config.get("model"))
                .and_then(Value::as_str)
        })
        .or_else(|| composer.get("modelName").and_then(Value::as_str))
        .or_else(|| composer.get("model").and_then(Value::as_str))
        .map(pricing::canonical_model);

    let bubbles = if let Some(connection) = connection {
        load_bubbles(connection, &id, composer, &updated, base_model.as_deref())
    } else {
        Vec::new()
    };

    let mut title = ["name", "title", "subtitle"].iter().find_map(|key| {
        composer
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| {
                !value.is_empty()
                    && !matches!(
                        value.to_ascii_lowercase().as_str(),
                        "new agent" | "new composer" | "untitled" | "untitled session"
                    )
            })
            .map(str::to_string)
    });
    let first_user = bubbles.iter().find(|bubble| bubble.role == "user");
    let first_assistant = bubbles.iter().find(|bubble| bubble.role == "assistant");
    if title.is_none() {
        title = first_user
            .map(|bubble| excerpt(&bubble.text, 76))
            .filter(|value| !value.is_empty());
    }
    let title = title.unwrap_or_else(|| "Untitled Cursor composer".to_string());
    let excerpt_text = first_assistant
        .map(|bubble| excerpt(&bubble.text, 168))
        .or_else(|| first_user.map(|bubble| excerpt(&bubble.text, 168)))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "A Cursor composer stored in the local database.".to_string());

    let mut models_set: HashSet<String> = HashSet::new();
    if let Some(model) = &base_model {
        models_set.insert(model.clone());
    }
    let mut input = 0u64;
    let mut output = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    let mut cost = 0.0f64;
    let mut known_cost = false;
    let mut usage_days = crate::util::UsageDays::default();
    let mut earliest = created.clone();
    let mut latest = updated.clone();
    let mut messages = Vec::new();
    let mut size_bytes = serde_json::to_vec(composer)
        .map(|bytes| bytes.len() as u64)
        .unwrap_or(0);

    if connection.is_some() {
        size_bytes = size_bytes.saturating_add(composer_size(connection, &id));
    }

    let mut timing = crate::timing::Collector::default();
    for bubble in &bubbles {
        if matches!(bubble.role.as_str(), "user" | "assistant")
            && (!bubble.text.trim().is_empty() || bubble.tool_name.is_some())
            && !crate::util::is_injected_context(&bubble.text)
        {
            if let Some(stamp) = &bubble.genuine_timestamp {
                timing.activity(&Value::String(stamp.clone()));
            }
        }
        earliest = earlier(&earliest, &bubble.timestamp);
        latest = later(&latest, &bubble.timestamp);
        if let Some(model) = &bubble.model {
            models_set.insert(model.clone());
        }
        if bubble.role == "assistant" {
            input = input.saturating_add(bubble.input);
            output = output.saturating_add(bubble.output);
            cache_read = cache_read.saturating_add(bubble.cache_read);
            cache_write = cache_write.saturating_add(bubble.cache_write);
            let estimate = bubble.model.as_deref().and_then(|model| {
                pricing::estimate(
                    model,
                    bubble.input,
                    bubble.output,
                    bubble.cache_read,
                    bubble.cache_write,
                )
            });
            if let Some(estimate) = estimate {
                cost += estimate;
                known_cost = true;
            }
            usage_days.add(
                &bubble.timestamp,
                bubble.input,
                bubble.output,
                bubble.cache_read,
                bubble.cache_write,
                estimate,
            );
        }
        if with_messages {
            if !bubble.text.trim().is_empty() {
                messages.push(Message {
                    id: bubble.id.clone(),
                    role: bubble.role.clone(),
                    content: truncate_chars(&bubble.text, MAX_TEXT),
                    timestamp: bubble.timestamp.clone(),
                    model: bubble.model.clone(),
                    tool_name: None,
                    tool_detail: None,
                    tool_status: None,
                    tokens: (bubble.tokens() > 0).then_some(bubble.tokens()),
                });
            }
            if let Some(tool_name) = &bubble.tool_name {
                messages.push(Message {
                    id: format!("{}-tool", bubble.id),
                    role: "tool".to_string(),
                    content: truncate_chars(
                        bubble.tool_content.as_deref().unwrap_or("(No output)"),
                        MAX_TOOL_CONTENT,
                    ),
                    timestamp: bubble.timestamp.clone(),
                    model: bubble.model.clone(),
                    tool_name: Some(tool_name.clone()),
                    tool_detail: bubble.tool_detail.clone(),
                    tool_status: bubble
                        .tool_status
                        .clone()
                        .or_else(|| Some("ok".to_string())),
                    tokens: None,
                });
            }
        }
    }

    let usage = if input + output + cache_read + cache_write > 0 {
        Some(UsageBreakdown {
            input,
            output,
            cache_read,
            cache_write,
            cost: if known_cost {
                Some((cost * 10_000.0).round() / 10_000.0)
            } else {
                None
            },
        })
    } else {
        None
    };
    let tokens = usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0);
    let mut models: Vec<String> = models_set.into_iter().collect();
    models.sort();
    if let Some(base_model) = &base_model {
        models.retain(|model| model != base_model);
        models.insert(0, base_model.clone());
    }
    let model = base_model.or_else(|| models.first().cloned());

    Ok(ParsedSession {
        summary: SessionSummary {
            timing: timing.finish(),
            id,
            agent: AgentId::Cursor,
            title,
            excerpt: excerpt_text,
            project,
            project_label,
            project_root: String::new(),
            project_root_label: String::new(),
            cwd: crate::util::display_path(Path::new(&cwd)),
            branch: None,
            created_at: earliest,
            updated_at: latest,
            message_count: bubbles
                .iter()
                .filter(|bubble| !bubble.text.trim().is_empty() || bubble.tool_name.is_some())
                .count() as u64,
            tokens,
            size_bytes,
            model,
            models,
            usage,
            usage_days: usage_days.into_vec(),
            format: "sqlite".to_string(),
            path: db.to_string_lossy().to_string(),
            deletable: false,
            tint,
            icon,
        },
        messages,
    })
}

fn composer_size(connection: Option<&Connection>, id: &str) -> u64 {
    let Some(connection) = connection else {
        return 0;
    };
    let pattern = format!("bubbleId:{}:%", escape_like(id));
    connection
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(key) + LENGTH(value)), 0) FROM cursorDiskKV WHERE key LIKE ?1 ESCAPE '\\'",
            [&pattern],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value.max(0) as u64)
        .unwrap_or(0)
}

fn workspace_uri(composer: &Value) -> Option<String> {
    let workspace = composer.get("workspaceIdentifier")?;
    if let Some(text) = workspace.as_str() {
        return Some(text.to_string());
    }
    ["uri", "path", "fsPath"].iter().find_map(|key| {
        workspace
            .get(*key)
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

fn file_uri_to_path(uri: &str) -> String {
    let uri = uri.trim();
    let path = uri.strip_prefix("file://").unwrap_or(uri);
    let mut decoded = String::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &path[index + 1..index + 3];
            if let Ok(value) = u8::from_str_radix(hex, 16) {
                decoded.push(value as char);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index] as char);
        index += 1;
    }
    #[cfg(target_os = "windows")]
    let decoded = {
        let trimmed = decoded.trim_start_matches('/');
        if trimmed.len() > 2 && trimmed.as_bytes()[1] == b':' {
            trimmed.to_string()
        } else {
            decoded
        }
    };
    decoded
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn load_bubbles(
    connection: &Connection,
    composer_id: &str,
    composer: &Value,
    fallback_stamp: &str,
    base_model: Option<&str>,
) -> Vec<Bubble> {
    let mut bubbles = Vec::new();
    let pattern = format!("bubbleId:{}:%", escape_like(composer_id));
    if let Ok(mut statement) =
        connection.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?1 ESCAPE '\\'")
    {
        if let Ok(rows) = statement.query_map([&pattern], |row| {
            let key: String = row.get(0)?;
            Ok((key, read_value(row.get_ref(1)?)))
        }) {
            for row in rows.flatten() {
                let (key, raw) = row;
                let Ok(value) = serde_json::from_slice::<Value>(&raw) else {
                    continue;
                };
                if let Some(bubble) = parse_bubble(&key, &value, fallback_stamp, base_model) {
                    bubbles.push(bubble);
                }
            }
        }
    }
    if bubbles.is_empty() {
        if let Some(conversation) = composer.get("conversation").and_then(Value::as_array) {
            for (index, value) in conversation.iter().enumerate() {
                let id = value
                    .get("bubbleId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("bubble-{index}"));
                if let Some(bubble) = parse_bubble(&id, value, fallback_stamp, base_model) {
                    bubbles.push(bubble);
                }
            }
        }
    }
    bubbles.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then_with(|| a.id.cmp(&b.id)));
    bubbles
}

fn parse_bubble(
    key: &str,
    value: &Value,
    fallback_stamp: &str,
    base_model: Option<&str>,
) -> Option<Bubble> {
    let bubble_id = value
        .get("bubbleId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| key.rsplit(':').next().map(str::to_string))
        .unwrap_or_else(|| "bubble".to_string());
    let role = value
        .get("role")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value.get("type").and_then(|kind| {
                if let Some(number) = kind.as_u64() {
                    Some(if number == 1 { "user" } else { "assistant" }.to_string())
                } else {
                    kind.as_str().map(|text| {
                        if text.eq_ignore_ascii_case("user") {
                            "user".to_string()
                        } else {
                            "assistant".to_string()
                        }
                    })
                }
            })
        })
        .unwrap_or_else(|| "assistant".to_string());
    let text = ["text", "content", "message"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| value.get("richText").and_then(Value::as_str).map(rich_text))
        .unwrap_or_default();
    let genuine_timestamp = value
        .get("createdAt")
        .and_then(parse_time)
        .or_else(|| value.get("timestamp").and_then(parse_time));
    let timestamp = genuine_timestamp.clone().unwrap_or_else(|| fallback_stamp.to_string());
    let genuine_timestamp = genuine_timestamp.filter(|_| {
        value["synthetic"].as_bool() != Some(true) && value["isMeta"].as_bool() != Some(true)
    });
    let model = value
        .get("modelInfo")
        .and_then(|info| info.get("modelName"))
        .and_then(Value::as_str)
        .or_else(|| value.get("modelName").and_then(Value::as_str))
        .or_else(|| value.get("model").and_then(Value::as_str))
        .or(base_model)
        .map(pricing::canonical_model);

    let mut input = 0u64;
    let mut output = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    for container in ["tokenCount", "usage"] {
        if let Some(usage) = value.get(container) {
            input = input.saturating_add(
                usage
                    .get("inputTokens")
                    .or_else(|| usage.get("promptTokens"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            );
            output = output.saturating_add(
                usage
                    .get("outputTokens")
                    .or_else(|| usage.get("completionTokens"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            );
            cache_read = cache_read.saturating_add(
                usage
                    .get("cacheReadTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            );
            cache_write = cache_write.saturating_add(
                usage
                    .get("cacheWriteTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            );
        }
    }

    let tool = value.get("toolFormerData");
    let tool_name = tool
        .and_then(|tool| tool.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            tool.and_then(|tool| tool.get("toolName"))
                .and_then(Value::as_str)
        })
        .map(str::to_string);
    let tool_content = tool.and_then(|tool| {
        ["result", "output", "rawArgs"]
            .iter()
            .find_map(|key| tool.get(*key).and_then(Value::as_str))
            .map(str::to_string)
    });
    let tool_detail = tool.and_then(|tool| {
        ["params", "rawArgs", "input"]
            .iter()
            .find_map(|key| tool.get(*key))
            .map(|value| match value {
                Value::String(text) => excerpt(text, MAX_TOOL_DETAIL),
                other => excerpt(&other.to_string(), MAX_TOOL_DETAIL),
            })
    });
    let tool_status = tool
        .and_then(|tool| tool.get("status"))
        .and_then(Value::as_str)
        .map(|status| {
            if status.eq_ignore_ascii_case("error") || status.eq_ignore_ascii_case("failed") {
                "error".to_string()
            } else {
                "ok".to_string()
            }
        });

    if text.trim().is_empty() && tool_name.is_none() {
        return None;
    }

    Some(Bubble {
        id: bubble_id,
        role,
        text,
        timestamp,
        genuine_timestamp,
        model,
        input,
        output,
        cache_read,
        cache_write,
        tool_name,
        tool_detail,
        tool_content,
        tool_status,
    })
}

fn rich_text(raw: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        if let Some(text) = value.as_str() {
            return text.to_string();
        }
        let mut pieces = Vec::new();
        collect_rich_text(&value, &mut pieces);
        if !pieces.is_empty() {
            return pieces.join(" ");
        }
    }
    raw.to_string()
}

fn collect_rich_text(value: &Value, pieces: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    pieces.push(text.to_string());
                }
            }
            if let Some(children) = map.get("children").and_then(Value::as_array) {
                for child in children {
                    collect_rich_text(child, pieces);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_rich_text(item, pieces);
            }
        }
        _ => {}
    }
}
