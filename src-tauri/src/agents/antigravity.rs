//! Google Antigravity keeps an index of conversations in
//! `conversation_summaries.db`: title, workspace and times, plus a search
//! table holding the text the user and the agent wrote. Each conversation also
//! has `conversations/<id>.db`, whose generation metadata records the model and
//! token usage. The `.pb` conversation files are encrypted and never read.
//! Everything is opened read-only.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{display_path, excerpt, file_size, iso_from_system_time, iso_now, project_info, truncate_chars};

use super::RelatedFile;

pub const DATABASE_NAME: &str = "conversation_summaries.db";
const CONVERSATIONS_DIR: &str = "conversations";
const INDEX_TABLES: &[&str] = &["conversation_summaries", "conversations_fts_content"];
const MAX_TEXT: usize = 120_000;

pub fn is_database(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(DATABASE_NAME)
}

/// The folder holding one database per conversation, next to the index.
pub fn conversations_dir(index: &Path) -> Option<PathBuf> {
    index.parent().map(|parent| parent.join(CONVERSATIONS_DIR))
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    super::sqlite::open_read_only(path, "Antigravity")
}

struct Row {
    id: String,
    title: String,
    preview: String,
    updated: String,
    workspace: Option<String>,
    parent: String,
    depth: i64,
}

fn read_rows(connection: &Connection) -> Vec<Row> {
    let Ok(mut statement) = connection.prepare(
        "SELECT conversation_id, title, preview, last_modified_time, workspace_uris, \
         parent_conversation_id, nesting_depth FROM conversation_summaries",
    ) else {
        return Vec::new();
    };
    let rows = statement.query_map([], |row| {
        let uris: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
        Ok(Row {
            id: row.get(0)?,
            title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            preview: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            updated: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            workspace: first_workspace(&uris),
            parent: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            depth: row.get::<_, Option<i64>>(6)?.unwrap_or(0),
        })
    });
    match rows {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => Vec::new(),
    }
}

/// Sub-agent runs are their own conversations; they are folded into the
/// top-level conversation that started them.
fn descendants(rows: &[Row]) -> HashMap<String, Vec<String>> {
    let parent_of: HashMap<&str, &str> = rows
        .iter()
        .filter(|row| !row.parent.is_empty())
        .map(|row| (row.id.as_str(), row.parent.as_str()))
        .collect();
    let mut tree: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows.iter().filter(|row| row.depth > 0) {
        let mut root = row.id.as_str();
        let mut guard = 0;
        while let Some(parent) = parent_of.get(root) {
            root = parent;
            guard += 1;
            if guard > 32 {
                break;
            }
        }
        if root != row.id {
            tree.entry(root.to_string()).or_default().push(row.id.clone());
        }
    }
    tree
}

fn first_workspace(uris: &str) -> Option<String> {
    let list: Vec<String> = serde_json::from_str(uris).ok()?;
    list.iter().find_map(|uri| file_uri_path(uri))
}

fn file_uri_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    let bytes = rest.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Some(byte) = std::str::from_utf8(&bytes[index + 1..index + 3])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
            {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    let path = String::from_utf8(decoded).ok()?;
    // Windows URIs look like file:///C:/Users/...
    let path = match path.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => path[1..].to_string(),
        _ => path,
    };
    (!path.is_empty()).then_some(path)
}

fn iso_from_antigravity(value: &str) -> Option<String> {
    let value = value.trim();
    DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z")
        .or_else(|_| DateTime::parse_from_rfc3339(value))
        .ok()
        .map(|stamp| stamp.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Millis, true))
}

// ---------------------------------------------------------------------------
// Transcript text from the search index
// ---------------------------------------------------------------------------

struct Segment {
    step: i64,
    role: &'static str,
    text: String,
}

/// The index stores each side of the conversation as one body of text plus a
/// list of `[step, byte offset]` pairs marking where each step starts.
fn split_body(offsets: &str, body: &str, role: &'static str, into: &mut Vec<Segment>) {
    let Ok(pairs) = serde_json::from_str::<Vec<Vec<i64>>>(offsets) else {
        return;
    };
    let bytes = body.as_bytes();
    let starts: Vec<(i64, usize)> = pairs
        .iter()
        .filter_map(|pair| match pair.as_slice() {
            [step, offset] if *offset >= 0 => Some((*step, *offset as usize)),
            _ => None,
        })
        .collect();
    for (index, (step, start)) in starts.iter().enumerate() {
        let end = starts
            .get(index + 1)
            .map(|(_, next)| *next)
            .unwrap_or(bytes.len())
            .min(bytes.len());
        if *start >= end {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes[*start..end]).trim().to_string();
        if !text.is_empty() {
            into.push(Segment {
                step: *step,
                role,
                text,
            });
        }
    }
}

fn transcript(connection: &Connection, id: &str) -> Vec<Segment> {
    let Ok(mut statement) = connection.prepare(
        "SELECT c8, c9, c13, c14 FROM conversations_fts_content \
         WHERE c0 = ?1 AND CAST(c1 AS INTEGER) >= 0 ORDER BY CAST(c1 AS INTEGER)",
    ) else {
        return Vec::new();
    };
    // Offsets are stored as text or as blobs, depending on the version.
    let text = |row: &rusqlite::Row<'_>, index: usize| -> rusqlite::Result<String> {
        Ok(match row.get::<_, SqlValue>(index)? {
            SqlValue::Text(text) => text,
            SqlValue::Blob(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            _ => String::new(),
        })
    };
    let Ok(rows) = statement.query_map([id], |row| {
        Ok((text(row, 0)?, text(row, 1)?, text(row, 2)?, text(row, 3)?))
    }) else {
        return Vec::new();
    };
    let mut segments = Vec::new();
    for (user_offsets, agent_offsets, user_body, agent_body) in rows.flatten() {
        split_body(&user_offsets, &user_body, "user", &mut segments);
        split_body(&agent_offsets, &agent_body, "assistant", &mut segments);
    }
    segments.sort_by_key(|segment| segment.step);
    // Consecutive agent steps read as one reply.
    let mut merged: Vec<Segment> = Vec::new();
    for segment in segments {
        match merged.last_mut() {
            Some(last) if last.role == segment.role && segment.role == "assistant" => {
                last.text.push_str("\n\n");
                last.text.push_str(&segment.text);
            }
            _ => merged.push(segment),
        }
    }
    merged
}

// ---------------------------------------------------------------------------
// Model and token usage from the per-conversation databases
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Generations {
    usage: UsageBreakdown,
    models: Vec<String>,
}

fn varint(bytes: &[u8], index: &mut usize) -> Option<u64> {
    let mut value: u64 = 0;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*index)?;
        *index += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Some(value);
        }
    }
    None
}

enum Field<'a> {
    Number(u64),
    Bytes(&'a [u8]),
}

/// Minimal protobuf wire-format reader: yields `(field number, value)`.
fn fields(bytes: &[u8]) -> Vec<(u64, Field<'_>)> {
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let Some(key) = varint(bytes, &mut index) else {
            break;
        };
        let number = key >> 3;
        match key & 7 {
            0 => match varint(bytes, &mut index) {
                Some(value) => out.push((number, Field::Number(value))),
                None => break,
            },
            1 => index += 8,
            5 => index += 4,
            2 => {
                let Some(length) = varint(bytes, &mut index) else {
                    break;
                };
                let end = index.saturating_add(length as usize);
                if end > bytes.len() {
                    break;
                }
                out.push((number, Field::Bytes(&bytes[index..end])));
                index = end;
            }
            _ => break,
        }
    }
    out
}

fn message_field(bytes: &[u8], number: u64) -> Option<&[u8]> {
    fields(bytes).into_iter().find_map(|(field, value)| match value {
        Field::Bytes(inner) if field == number => Some(inner),
        _ => None,
    })
}

/// `claude-opus-5-5-high` → `claude-opus-5-5`: the suffix is a thinking level.
fn model_id(raw: &str) -> String {
    let mut model = raw.trim().to_ascii_lowercase();
    for suffix in ["-high", "-medium", "-low", "-max", "-thinking", "-control"] {
        if let Some(stripped) = model.strip_suffix(suffix) {
            model = stripped.to_string();
            break;
        }
    }
    pricing::canonical_model(&model)
}

fn read_generations(db: &Path, into: &mut Generations) {
    let Ok(connection) = open_read_only(db) else {
        return;
    };
    let Ok(mut statement) = connection.prepare("SELECT data FROM gen_metadata ORDER BY idx") else {
        return;
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, Option<Vec<u8>>>(0)) else {
        return;
    };
    for data in rows.flatten().flatten() {
        let Some(generation) = message_field(&data, 1) else {
            continue;
        };
        if let Some(model) = message_field(generation, 19)
            .and_then(|raw| std::str::from_utf8(raw).ok())
            .filter(|raw| !raw.trim().is_empty())
            .map(model_id)
        {
            if !into.models.contains(&model) {
                into.models.push(model);
            }
        }
        let Some(usage) = message_field(generation, 4) else {
            continue;
        };
        for (field, value) in fields(usage) {
            let Field::Number(count) = value else {
                continue;
            };
            match field {
                // Uncached input, output (thinking included) and cached input.
                2 => into.usage.input = into.usage.input.saturating_add(count),
                3 => into.usage.output = into.usage.output.saturating_add(count),
                5 => into.usage.cache_read = into.usage.cache_read.saturating_add(count),
                _ => {}
            }
        }
    }
}

/// Older conversations only have an encrypted `.pb` file; it still tells
/// SessionPal how large the conversation is and when it started.
fn encrypted_file(index: &Path, id: &str) -> Option<PathBuf> {
    let path = conversations_dir(index)?.join(format!("{id}.pb"));
    path.is_file().then_some(path)
}

fn conversation_files(index: &Path, ids: &[&str]) -> Vec<PathBuf> {
    let Some(dir) = conversations_dir(index) else {
        return Vec::new();
    };
    ids.iter()
        .map(|id| dir.join(format!("{id}.db")))
        .filter(|path| path.is_file())
        .collect()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

struct Loaded {
    connection: Connection,
    rows: Vec<Row>,
    children: HashMap<String, Vec<String>>,
}

fn load(index: &Path) -> Result<Loaded, String> {
    let connection = open_read_only(index)?;
    let rows = read_rows(&connection);
    let children = descendants(&rows);
    Ok(Loaded {
        connection,
        rows,
        children,
    })
}

fn family<'a>(loaded: &'a Loaded, id: &'a str) -> Vec<&'a str> {
    let mut ids = vec![id];
    if let Some(children) = loaded.children.get(id) {
        ids.extend(children.iter().map(String::as_str));
    }
    ids
}

pub fn count_sessions(roots: &[PathBuf]) -> u64 {
    roots
        .iter()
        .filter(|root| is_database(root))
        .filter_map(|root| load(root).ok())
        .map(|loaded| loaded.rows.iter().filter(|row| row.depth == 0).count() as u64)
        .sum()
}

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for root in roots.iter().filter(|root| is_database(root)) {
        let Ok(loaded) = load(root) else {
            continue;
        };
        for row in loaded.rows.iter().filter(|row| row.depth == 0) {
            if !seen.insert(row.id.clone()) {
                continue;
            }
            let segments = transcript(&loaded.connection, &row.id);
            sessions.push(summarize(&loaded, root, row, &segments));
        }
    }
    sessions
}

pub fn detail(index: &Path, id: &str) -> Result<SessionDetail, String> {
    let loaded = load(index)?;
    let row = loaded
        .rows
        .iter()
        .find(|row| row.id == id)
        .ok_or_else(|| "That Antigravity conversation no longer exists.".to_string())?;
    let segments = transcript(&loaded.connection, &row.id);
    let summary = summarize(&loaded, index, row, &segments);
    let messages = segments
        .iter()
        .enumerate()
        .map(|(position, segment)| Message {
            id: format!("{}-{}-{}", row.id, segment.step, position),
            role: segment.role.to_string(),
            content: truncate_chars(&segment.text, MAX_TEXT),
            timestamp: String::new(),
            model: None,
            tool_name: None,
            tool_detail: None,
            tool_status: None,
            tokens: None,
        })
        .collect();
    let duration_ms = DateTime::parse_from_rfc3339(&summary.updated_at)
        .ok()
        .zip(DateTime::parse_from_rfc3339(&summary.created_at).ok())
        .map(|(updated, created)| (updated - created).num_milliseconds().max(0))
        .unwrap_or(0);
    Ok(SessionDetail {
        summary,
        messages,
        duration_ms,
    })
}

fn summarize(loaded: &Loaded, index: &Path, row: &Row, segments: &[Segment]) -> SessionSummary {
    let ids = family(loaded, &row.id);
    let files = conversation_files(index, &ids);
    let mut generations = Generations::default();
    for file in &files {
        read_generations(file, &mut generations);
    }
    let model = generations.models.first().cloned();
    let mut usage = generations.usage;
    usage.cost = generations
        .models
        .iter()
        .find_map(|model| {
            pricing::estimate(model, usage.input, usage.output, usage.cache_read, usage.cache_write)
        })
        .map(|cost| (cost * 10_000.0).round() / 10_000.0);
    let usage = (!usage.is_empty()).then_some(usage);

    let user_text = segments.iter().find(|segment| segment.role == "user").map(|s| s.text.as_str());
    let agent_text = segments
        .iter()
        .find(|segment| segment.role == "assistant")
        .map(|s| s.text.as_str());

    let cwd = row
        .workspace
        .clone()
        .unwrap_or_else(|| "Antigravity workspace".to_string());
    let (project, project_label, tint, icon) = project_info(&cwd, "Antigravity");

    let title = [row.title.trim(), row.preview.trim()]
        .into_iter()
        .find(|text| !text.is_empty() && !text.starts_with('<'))
        .map(|text| excerpt(text, 76))
        .or_else(|| user_text.map(|text| excerpt(text, 76)))
        .unwrap_or_else(|| "Untitled Antigravity conversation".to_string());
    let excerpt_text = agent_text
        .or(user_text)
        .map(|text| excerpt(text, 168))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "A local Antigravity conversation.".to_string());

    let updated = iso_from_antigravity(&row.updated).unwrap_or_else(iso_now);
    let encrypted = encrypted_file(index, &row.id);
    let created = files
        .first()
        .or(encrypted.as_ref())
        .and_then(|file| fs::metadata(file).ok())
        .and_then(|meta| meta.created().ok())
        .map(iso_from_system_time)
        .filter(|created| created.as_str() <= updated.as_str())
        .unwrap_or_else(|| updated.clone());

    SessionSummary {
        id: row.id.clone(),
        agent: AgentId::Antigravity,
        title,
        excerpt: excerpt_text,
        project,
        project_label,
        cwd: display_path(Path::new(&cwd)),
        branch: None,
        created_at: created,
        updated_at: updated,
        message_count: segments.len() as u64,
        tokens: usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0),
        size_bytes: files.iter().chain(encrypted.iter()).map(|file| file_size(file)).sum(),
        models: generations.models,
        model,
        usage,
        // Only session-level totals are available here.
        usage_days: Vec::new(),
        format: "sqlite".to_string(),
        path: index.to_string_lossy().to_string(),
        // Never write to another app's live data.
        deletable: false,
        tint,
        icon,
    }
}

/// The shared index plus the conversation's own databases (sub-agents included).
pub fn related_files(index: &Path, id: &str) -> Vec<RelatedFile> {
    let mut files = vec![RelatedFile {
        path: index.to_path_buf(),
        kind: "antigravity-index".to_string(),
        session_id: None,
    }];
    if let Ok(loaded) = load(index) {
        for path in conversation_files(index, &family(&loaded, id)) {
            files.push(RelatedFile {
                session_id: path.file_stem().and_then(|stem| stem.to_str()).map(str::to_string),
                path,
                kind: "antigravity-conversation".to_string(),
            });
        }
    }
    files
}

/// Copies a database into the archive staging area. The index keeps only its
/// conversation tables; a conversation database is copied whole.
pub(crate) fn snapshot(kind: &str, source: &Path, destination: &Path) -> Result<(), String> {
    let connection = open_read_only(source)?;
    let tables = (kind == "antigravity-index").then_some(INDEX_TABLES);
    let copied = super::sqlite::copy_tables(&connection, destination, tables, "Antigravity chats")?;
    if kind == "antigravity-index" && !copied.contains("conversation_summaries") {
        return Err("The Antigravity index has no conversation table.".to_string());
    }
    Ok(())
}
