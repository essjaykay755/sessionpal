//! OpenCode 1.x+ keeps sessions in a SQLite database (`opencode.db`) instead of
//! JSON files. The current schema stores them in `session_v2` and
//! `session_message`; sessions created before that live in `session`,
//! `message` and `part`. Both are read here, always read-only.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{display_path, excerpt, iso_from_millis, iso_now, project_info, truncate_chars};

use super::opencode::compact_input;

pub const DATABASE_NAME: &str = "opencode.db";

const MAX_TEXT: usize = 120_000;
const MAX_TOOL_CONTENT: usize = 24_000;

/// Tables that hold conversations. The database also has account and
/// credential tables, which are never read or copied.
const CHAT_TABLES: &[&str] = &[
    "project",
    "session",
    "message",
    "part",
    "todo",
    "session_v2",
    "session_message",
    "session_part",
];

pub fn is_database(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(DATABASE_NAME)
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    super::sqlite::open_read_only(path, "OpenCode")
}

fn has_table(connection: &Connection, name: &str) -> bool {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false)
}

#[derive(Clone, Copy, PartialEq)]
enum Schema {
    /// `session_v2` + `session_message`.
    Current,
    /// `session` + `message` + `part`.
    Legacy,
}

struct SessionRow {
    id: String,
    title: Option<String>,
    directory: String,
    model: Option<String>,
    cost: f64,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    created: i64,
    updated: i64,
    schema: Schema,
}

const SESSION_COLUMNS: &str = "id, title, directory, model, cost, tokens_input, tokens_output, \
     tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated";

fn read_rows(connection: &Connection, only: Option<&str>) -> Vec<SessionRow> {
    let current = has_table(connection, "session_v2");
    let legacy = has_table(connection, "session");
    let mut queries: Vec<(String, Schema)> = Vec::new();
    if current {
        queries.push((format!("SELECT {SESSION_COLUMNS} FROM session_v2"), Schema::Current));
    }
    if legacy {
        let filter = if current { " WHERE id NOT IN (SELECT id FROM session_v2)" } else { "" };
        queries.push((format!("SELECT {SESSION_COLUMNS} FROM session{filter}"), Schema::Legacy));
    }

    let mut rows = Vec::new();
    for (mut sql, schema) in queries {
        if only.is_some() {
            sql.push_str(if sql.contains(" WHERE ") { " AND id = ?1" } else { " WHERE id = ?1" });
        }
        let Ok(mut statement) = connection.prepare(&sql) else {
            continue;
        };
        let map = |row: &rusqlite::Row<'_>| {
            let count = |index: usize| row.get::<_, Option<i64>>(index).map(|v| v.unwrap_or(0).max(0) as u64);
            Ok(SessionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                directory: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                model: row.get(3)?,
                cost: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                input: count(5)?,
                // OpenCode reports reasoning separately; it is billed as output.
                output: count(6)? + count(7)?,
                cache_read: count(8)?,
                cache_write: count(9)?,
                created: row.get::<_, Option<i64>>(10)?.unwrap_or(0),
                updated: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
                schema,
            })
        };
        let result = match only {
            Some(id) => statement.query_map([id], map).map(|rows| rows.flatten().collect::<Vec<_>>()),
            None => statement.query_map([], map).map(|rows| rows.flatten().collect::<Vec<_>>()),
        };
        if let Ok(found) = result {
            rows.extend(found);
        }
    }
    rows
}

pub fn count_sessions(db: &Path) -> u64 {
    open_read_only(db)
        .map(|connection| read_rows(&connection, None).len() as u64)
        .unwrap_or(0)
}

pub fn scan(db: &Path) -> Vec<SessionSummary> {
    let Ok(connection) = open_read_only(db) else {
        return Vec::new();
    };
    read_rows(&connection, None)
        .iter()
        .map(|row| summarize(&connection, db, row))
        .collect()
}

pub fn detail(db: &Path, session_id: &str) -> Result<SessionDetail, String> {
    let connection = open_read_only(db)?;
    let row = read_rows(&connection, Some(session_id))
        .into_iter()
        .next()
        .ok_or_else(|| "That OpenCode session no longer exists in the database.".to_string())?;
    let summary = summarize(&connection, db, &row);
    let messages = match row.schema {
        Schema::Current => current_messages(&connection, &row.id)?,
        Schema::Legacy => legacy_messages(&connection, &row.id)?,
    };
    let duration_ms = (row.updated - row.created).max(0);
    Ok(SessionDetail {
        summary,
        messages,
        duration_ms,
    })
}

fn model_id(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(map)) => map.get("id").and_then(Value::as_str).map(str::to_string),
        Ok(Value::String(text)) => Some(text),
        _ => Some(raw.to_string()),
    }
}

fn single_text(connection: &Connection, sql: &str, id: &str) -> Option<String> {
    connection
        .query_row(sql, [id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .ok()
        .flatten()
        .flatten()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn summarize(connection: &Connection, db: &Path, row: &SessionRow) -> SessionSummary {
    let (count_sql, size_sql, user_sql, assistant_sql, legacy_model_sql) = match row.schema {
        Schema::Current => (
            "SELECT COUNT(*) FROM session_message WHERE session_id = ?1 AND type IN ('user', 'assistant')",
            "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM session_message WHERE session_id = ?1",
            "SELECT json_extract(data, '$.text') FROM session_message \
             WHERE session_id = ?1 AND type = 'user' ORDER BY seq LIMIT 1",
            "SELECT data FROM session_message WHERE session_id = ?1 AND type = 'assistant' \
             AND data LIKE '%\"type\":\"text\"%' ORDER BY seq LIMIT 1",
            None,
        ),
        Schema::Legacy => (
            "SELECT COUNT(*) FROM message WHERE session_id = ?1",
            "SELECT COALESCE((SELECT SUM(LENGTH(data)) FROM message WHERE session_id = ?1), 0) \
             + COALESCE((SELECT SUM(LENGTH(data)) FROM part WHERE session_id = ?1), 0)",
            "SELECT json_extract(p.data, '$.text') FROM part p JOIN message m ON m.id = p.message_id \
             WHERE m.session_id = ?1 AND json_extract(m.data, '$.role') = 'user' \
             AND json_extract(p.data, '$.type') = 'text' ORDER BY m.time_created, p.id LIMIT 1",
            "SELECT json_extract(p.data, '$.text') FROM part p JOIN message m ON m.id = p.message_id \
             WHERE m.session_id = ?1 AND json_extract(m.data, '$.role') = 'assistant' \
             AND json_extract(p.data, '$.type') = 'text' ORDER BY m.time_created, p.id LIMIT 1",
            Some(
                "SELECT json_extract(data, '$.modelID') FROM message \
                 WHERE session_id = ?1 AND json_extract(data, '$.role') = 'assistant' LIMIT 1",
            ),
        ),
    };

    let message_count = connection
        .query_row(count_sql, [&row.id], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as u64;
    let size_bytes = connection
        .query_row(size_sql, [&row.id], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as u64;
    let user_text = single_text(connection, user_sql, &row.id);
    let assistant_text = match row.schema {
        Schema::Current => single_text(connection, assistant_sql, &row.id).and_then(|raw| {
            let data: Value = serde_json::from_str(&raw).ok()?;
            data.get("content")?.as_array()?.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| item.get("text").and_then(Value::as_str).map(str::to_string))
                    .flatten()
            })
        }),
        Schema::Legacy => single_text(connection, assistant_sql, &row.id),
    };

    let model = model_id(row.model.as_deref())
        .or_else(|| legacy_model_sql.and_then(|sql| single_text(connection, sql, &row.id)))
        .map(|model| pricing::canonical_model(&model));

    let mut usage = UsageBreakdown {
        input: row.input,
        output: row.output,
        cache_read: row.cache_read,
        cache_write: row.cache_write,
        cost: None,
    };
    usage.cost = model
        .as_deref()
        .and_then(|model| {
            pricing::estimate(model, usage.input, usage.output, usage.cache_read, usage.cache_write)
        })
        .or((row.cost > 0.0).then_some(row.cost))
        .map(|cost| (cost * 10_000.0).round() / 10_000.0);
    let usage = (!usage.is_empty() || usage.cost.unwrap_or(0.0) > 0.0).then_some(usage);

    let cwd = if row.directory.trim().is_empty() {
        "OpenCode workspace".to_string()
    } else {
        row.directory.clone()
    };
    let (project, project_label, tint, icon) = project_info(&cwd, "OpenCode");
    let title = row
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| {
            !title.is_empty()
                && !title.starts_with("New session")
                && !matches!(*title, "Untitled" | "Untitled session")
        })
        .map(str::to_string)
        .or_else(|| user_text.as_deref().map(|text| excerpt(text, 76)))
        .unwrap_or_else(|| "Untitled OpenCode session".to_string());
    let excerpt_text = assistant_text
        .as_deref()
        .or(user_text.as_deref())
        .map(|text| excerpt(text, 168))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "A local OpenCode conversation.".to_string());
    let updated = iso_from_millis(row.updated).unwrap_or_else(iso_now);
    let created = iso_from_millis(row.created).unwrap_or_else(|| updated.clone());

    SessionSummary {
        id: row.id.clone(),
        agent: AgentId::Opencode,
        title,
        excerpt: excerpt_text,
        project,
        project_label,
        project_root: String::new(),
        project_root_label: String::new(),
        cwd: display_path(Path::new(&cwd)),
        branch: None,
        created_at: created,
        updated_at: updated,
        message_count,
        tokens: usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0),
        size_bytes,
        models: model.iter().cloned().collect(),
        model,
        usage,
        // Only session-level totals are available here.
        usage_days: Vec::new(),
        format: "sqlite".to_string(),
        path: db.to_string_lossy().to_string(),
        // Never write to another app's live database.
        deletable: false,
        tint,
        icon,
    }
}

fn text_message(id: String, role: &str, text: &str, stamp: &str, model: Option<String>) -> Message {
    Message {
        id,
        role: role.to_string(),
        content: truncate_chars(text, MAX_TEXT),
        timestamp: stamp.to_string(),
        model,
        tool_name: None,
        tool_detail: None,
        tool_status: None,
        tokens: None,
    }
}

fn push_tool(
    messages: &mut Vec<Message>,
    base: &str,
    index: usize,
    name: &str,
    input: &Value,
    output: &str,
    failed: bool,
    stamp: &str,
) {
    let body = serde_json::to_string_pretty(input).unwrap_or_default();
    messages.push(Message {
        id: format!("{base}-tool-{index}"),
        role: "tool".to_string(),
        content: truncate_chars(&body, MAX_TOOL_CONTENT),
        timestamp: stamp.to_string(),
        model: None,
        tool_name: Some(name.to_string()),
        tool_detail: Some(compact_input(input)),
        tool_status: Some("ok".to_string()),
        tokens: None,
    });
    messages.push(Message {
        id: format!("{base}-result-{index}"),
        role: "tool".to_string(),
        content: truncate_chars(if output.trim().is_empty() { "(No output)" } else { output }, MAX_TOOL_CONTENT),
        timestamp: stamp.to_string(),
        model: None,
        tool_name: Some(name.to_string()),
        tool_detail: Some(if failed { "Tool call failed" } else { "Tool call completed" }.to_string()),
        tool_status: Some(if failed { "error" } else { "ok" }.to_string()),
        tokens: None,
    });
}

fn current_messages(connection: &Connection, session_id: &str) -> Result<Vec<Message>, String> {
    let failed = |error: rusqlite::Error| format!("Could not read the OpenCode session: {error}");
    let mut statement = connection
        .prepare(
            "SELECT id, type, data, time_created FROM session_message \
             WHERE session_id = ?1 ORDER BY seq",
        )
        .map_err(failed)?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            ))
        })
        .map_err(failed)?;

    let mut messages = Vec::new();
    for (id, kind, raw, created) in rows.flatten() {
        let Ok(data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let stamp = iso_from_millis(created).unwrap_or_default();
        let text = data.get("text").and_then(Value::as_str).unwrap_or_default();
        match kind.as_str() {
            "user" if !text.trim().is_empty() => messages.push(text_message(id, "user", text, &stamp, None)),
            "system" | "synthetic" if !text.trim().is_empty() => {
                messages.push(text_message(id, "system", text, &stamp, None))
            }
            "compaction" => {
                let summary = data.get("summary").and_then(Value::as_str).unwrap_or_default();
                messages.push(text_message(
                    id,
                    "system",
                    &format!("Conversation compacted.\n\n{summary}"),
                    &stamp,
                    None,
                ));
            }
            "assistant" => {
                let model = data
                    .get("model")
                    .and_then(|model| model.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let Some(content) = data.get("content").and_then(Value::as_array) else {
                    continue;
                };
                for (index, item) in content.iter().enumerate() {
                    match item.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            let text = item.get("text").and_then(Value::as_str).unwrap_or_default();
                            if !text.trim().is_empty() {
                                messages.push(text_message(
                                    format!("{id}-text-{index}"),
                                    "assistant",
                                    text,
                                    &stamp,
                                    model.clone(),
                                ));
                            }
                        }
                        Some("tool") => {
                            let state = item.get("state").cloned().unwrap_or(Value::Null);
                            let output = state
                                .get("content")
                                .and_then(Value::as_array)
                                .map(|items| {
                                    items
                                        .iter()
                                        .filter_map(|part| part.get("text").and_then(Value::as_str))
                                        .collect::<Vec<_>>()
                                        .join("\n")
                                })
                                .unwrap_or_default();
                            push_tool(
                                &mut messages,
                                &id,
                                index,
                                item.get("name").and_then(Value::as_str).unwrap_or("tool"),
                                state.get("input").unwrap_or(&Value::Null),
                                &output,
                                state.get("status").and_then(Value::as_str) == Some("error"),
                                &stamp,
                            );
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    Ok(messages)
}

fn legacy_messages(connection: &Connection, session_id: &str) -> Result<Vec<Message>, String> {
    let failed = |error: rusqlite::Error| format!("Could not read the OpenCode session: {error}");
    let mut parts: HashMap<String, Vec<Value>> = HashMap::new();
    {
        let mut statement = connection
            .prepare("SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY time_created, id")
            .map_err(failed)?;
        let rows = statement
            .query_map([session_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(failed)?;
        for (message_id, raw) in rows.flatten() {
            if let Ok(part) = serde_json::from_str::<Value>(&raw) {
                parts.entry(message_id).or_default().push(part);
            }
        }
    }

    let mut statement = connection
        .prepare("SELECT id, data, time_created FROM message WHERE session_id = ?1 ORDER BY time_created, id")
        .map_err(failed)?;
    let rows = statement
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            ))
        })
        .map_err(failed)?;

    let mut messages = Vec::new();
    for (id, raw, created) in rows.flatten() {
        let Ok(data) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let role = data.get("role").and_then(Value::as_str).unwrap_or("assistant");
        let role = if role == "user" { "user" } else { "assistant" };
        let model = data.get("modelID").and_then(Value::as_str).map(str::to_string);
        let stamp = iso_from_millis(created).unwrap_or_default();
        for (index, part) in parts.remove(&id).unwrap_or_default().iter().enumerate() {
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = part.get("text").and_then(Value::as_str).unwrap_or_default();
                    let synthetic = part.get("synthetic").and_then(Value::as_bool).unwrap_or(false);
                    if !text.trim().is_empty() {
                        messages.push(text_message(
                            format!("{id}-text-{index}"),
                            if synthetic { "system" } else { role },
                            text,
                            &stamp,
                            (role == "assistant").then(|| model.clone()).flatten(),
                        ));
                    }
                }
                Some("tool") => {
                    let state = part.get("state").cloned().unwrap_or(Value::Null);
                    let output = state
                        .get("output")
                        .or_else(|| state.get("error"))
                        .map(|value| value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string()))
                        .unwrap_or_default();
                    push_tool(
                        &mut messages,
                        &id,
                        index,
                        part.get("tool").and_then(Value::as_str).unwrap_or("tool"),
                        state.get("input").unwrap_or(&Value::Null),
                        &output,
                        state.get("status").and_then(Value::as_str) == Some("error"),
                        &stamp,
                    );
                }
                _ => {}
            }
        }
    }
    Ok(messages)
}

/// Copies only OpenCode's conversation tables into a fresh database, so
/// account and credential tables never end up in an archive.
pub(crate) fn snapshot_chats(source: &Path, destination: &Path) -> Result<(), String> {
    let source_connection = open_read_only(source)?;
    let copied = super::sqlite::copy_tables(&source_connection, destination, Some(CHAT_TABLES), "OpenCode chats")?;
    if !copied.contains("session") && !copied.contains("session_v2") {
        return Err("The OpenCode database has no session tables.".to_string());
    }
    Ok(())
}
