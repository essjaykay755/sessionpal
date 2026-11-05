use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use crate::models::{AgentId, Message, SessionDetail, SessionSummary, UsageBreakdown};
use crate::pricing;
use crate::util::{
    earlier, excerpt, file_size, file_times, iso_now, later, parse_time, project_info,
    truncate_chars,
};

use super::{opencode_db, ParsedSession, RelatedFile};

const MAX_TEXT: usize = 120_000;
const MAX_TOOL_CONTENT: usize = 24_000;
const MAX_TOOL_DETAIL: usize = 420;

pub fn count_sessions(roots: &[PathBuf]) -> u64 {
    let mut count = 0;
    for root in roots {
        if opencode_db::is_database(root) {
            count += opencode_db::count_sessions(root);
            continue;
        }
        let session_root = root.join("session");
        if !session_root.exists() {
            continue;
        }
        for entry in WalkDir::new(session_root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file()
                && entry.path().extension().and_then(|ext| ext.to_str()) == Some("json")
            {
                count += 1;
            }
        }
    }
    count
}

pub fn scan(roots: &[PathBuf]) -> Vec<SessionSummary> {
    // Newer OpenCode versions keep sessions in opencode.db. Read those first and
    // skip any JSON copy of the same session left over from before the move.
    let mut sessions: Vec<SessionSummary> = roots
        .iter()
        .filter(|root| opencode_db::is_database(root))
        .flat_map(|db| opencode_db::scan(db))
        .collect();
    let in_database: HashSet<String> = sessions.iter().map(|session| session.id.clone()).collect();
    for root in roots {
        if opencode_db::is_database(root) {
            continue;
        }
        let session_root = root.join("session");
        if !session_root.exists() {
            continue;
        }
        for entry in WalkDir::new(&session_root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file()
                || entry.path().extension().and_then(|ext| ext.to_str()) != Some("json")
            {
                continue;
            }
            if let Ok(parsed) = parse_session(root, entry.path(), false) {
                if !in_database.contains(&parsed.summary.id) {
                    sessions.push(parsed.summary);
                }
            }
        }
    }
    sessions
}

pub fn detail(path: &Path) -> Result<SessionDetail, String> {
    let root = storage_root(path).ok_or_else(|| {
        "Could not locate the OpenCode storage root for this session.".to_string()
    })?;
    let parsed = parse_session(&root, path, true)?;
    let duration = duration_ms(&parsed.summary.created_at, &parsed.summary.updated_at);
    Ok(SessionDetail {
        summary: parsed.summary,
        messages: parsed.messages,
        duration_ms: duration,
    })
}

pub fn storage_root(session_path: &Path) -> Option<PathBuf> {
    let mut current = session_path.parent();
    while let Some(parent) = current {
        if parent.file_name().and_then(|name| name.to_str()) == Some("session") {
            return parent.parent().map(Path::to_path_buf);
        }
        current = parent.parent();
    }
    None
}

fn id_from_session(session: &Value, path: &Path) -> String {
    session
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("session")
                .to_string()
        })
}

/// Reads the session ID from the session file itself. Callers must never use an
/// ID supplied by the UI to locate message, part or todo files.
pub fn session_id(session_path: &Path) -> Result<String, String> {
    let raw = fs::read(session_path)
        .map_err(|error| format!("Could not read OpenCode session: {error}"))?;
    let session: Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Could not parse OpenCode session JSON: {error}"))?;
    let id = id_from_session(&session, session_path);
    if !crate::util::is_safe_component(&id) {
        return Err("The OpenCode session ID is not a safe file name.".to_string());
    }
    Ok(id)
}

pub fn related_files(session_path: &Path) -> Result<Vec<RelatedFile>, String> {
    let root = storage_root(session_path).ok_or_else(|| {
        "The OpenCode session is not inside a storage/session directory.".to_string()
    })?;
    let id = session_id(session_path)?;
    let mut files: Vec<RelatedFile> = Vec::new();
    push_file(&mut files, session_path, "session", Some(id.clone()));
    let message_dir = root.join("message").join(&id);
    if message_dir.is_dir() {
        for entry in sorted_json_files(&message_dir) {
            let message_id = entry
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_string();
            push_file(&mut files, &entry, "opencode-message", Some(id.clone()));
            if crate::util::is_safe_component(&message_id) {
                let part_dir = root.join("part").join(&message_id);
                if part_dir.is_dir() {
                    for part in sorted_json_files(&part_dir) {
                        push_file(&mut files, &part, "opencode-part", Some(id.clone()));
                    }
                }
            }
        }
    }
    let todo = root.join("todo").join(format!("{id}.json"));
    if todo.is_file() {
        push_file(&mut files, &todo, "opencode-todo", Some(id));
    }
    Ok(files)
}

fn push_file(files: &mut Vec<RelatedFile>, path: &Path, kind: &str, session_id: Option<String>) {
    if path.is_file() {
        files.push(RelatedFile {
            path: path.to_path_buf(),
            kind: kind.to_string(),
            session_id,
        });
    }
}

fn sorted_json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("json")
        })
        .collect();
    files.sort();
    files
}

pub fn remove_session(session_path: &Path) -> Result<(), String> {
    let root = storage_root(session_path).ok_or_else(|| {
        "The OpenCode session is not inside a storage/session directory.".to_string()
    })?;
    let id = session_id(session_path)?;
    let root_canonical = fs::canonicalize(&root)
        .map_err(|error| format!("Could not resolve the OpenCode storage root: {error}"))?;
    let mut errors: Vec<String> = Vec::new();

    let message_dir = root.join("message").join(&id);
    let part_dirs = if message_dir.is_dir() {
        sorted_json_files(&message_dir)
            .into_iter()
            .filter_map(|path| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_string)
            })
            .filter(|id| crate::util::is_safe_component(id))
            .map(|message_id| root.join("part").join(message_id))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    if let Err(error) = crate::util::move_to_trash(session_path) {
        errors.push(error);
    }
    for dir in part_dirs {
        if dir.is_dir() {
            match fs::canonicalize(&dir) {
                Ok(canonical) if canonical.starts_with(&root_canonical) => {
                    if let Err(error) = crate::util::move_to_trash(&dir) {
                        errors.push(error);
                    }
                }
                _ => errors.push(format!("Refused to remove unsafe path: {}", dir.display())),
            }
        }
    }
    if message_dir.is_dir() {
        match fs::canonicalize(&message_dir) {
            Ok(canonical) if canonical.starts_with(&root_canonical) => {
                if let Err(error) = crate::util::move_to_trash(&message_dir) {
                    errors.push(error);
                }
            }
            _ => errors.push(format!(
                "Refused to remove unsafe path: {}",
                message_dir.display()
            )),
        }
    }
    let todo = root.join("todo").join(format!("{id}.json"));
    if todo.is_file() {
        if let Err(error) = crate::util::move_to_trash(&todo) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
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

#[derive(Clone)]
struct MessageMeta {
    id: String,
    role: String,
    created: Option<String>,
    model: Option<String>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    cost: Option<f64>,
}

struct Builder {
    id: String,
    title: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    models: HashSet<String>,
    usage: UsageBreakdown,
    known_cost: bool,
    message_count: u64,
    messages: Vec<Message>,
}

fn parse_session(root: &Path, path: &Path, with_messages: bool) -> Result<ParsedSession, String> {
    let raw =
        fs::read(path).map_err(|error| format!("Could not read OpenCode session: {error}"))?;
    let session: Value = serde_json::from_slice(&raw)
        .map_err(|error| format!("Could not parse OpenCode session JSON: {error}"))?;
    let id = id_from_session(&session, path);
    let project_id = session
        .get("projectID")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut cwd = session
        .get("directory")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    if cwd.is_none() && !project_id.is_empty() {
        let project_file = root.join("project").join(format!("{project_id}.json"));
        if let Ok(raw) = fs::read(&project_file) {
            if let Ok(project) = serde_json::from_slice::<Value>(&raw) {
                cwd = ["worktree", "directory", "path", "name"]
                    .iter()
                    .find_map(|key| {
                        project
                            .get(*key)
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string)
                    });
            }
        }
    }
    let cwd = cwd.unwrap_or_else(|| "OpenCode workspace".to_string());
    let (project, project_label, tint, icon) = project_info(&cwd, "OpenCode");

    let (file_created, file_updated) = file_times(path);
    let mut created = session
        .get("time")
        .and_then(|time| time.get("created"))
        .and_then(parse_time);
    let mut updated = session
        .get("time")
        .and_then(|time| time.get("updated"))
        .and_then(parse_time);
    if created.is_none() {
        created = Some(file_created);
    }
    if updated.is_none() {
        updated = Some(file_updated);
    }

    let message_dir = root.join("message").join(&id);
    let mut metas = Vec::new();
    if message_dir.is_dir() {
        for message_path in sorted_json_files(&message_dir) {
            if let Ok(raw) = fs::read(&message_path) {
                if let Ok(message) = serde_json::from_slice::<Value>(&raw) {
                    metas.push(parse_message_meta(&message, &message_path));
                }
            }
        }
    }
    metas.sort_by(|a, b| {
        a.created
            .as_deref()
            .unwrap_or("")
            .cmp(b.created.as_deref().unwrap_or(""))
            .then_with(|| a.id.cmp(&b.id))
    });

    let mut builder = Builder {
        id: id.clone(),
        title: session
            .get("title")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        created,
        updated,
        models: HashSet::new(),
        usage: UsageBreakdown::default(),
        known_cost: false,
        message_count: metas.len() as u64,
        messages: Vec::new(),
    };
    let mut usage_days = crate::util::UsageDays::default();

    for meta in &metas {
        if let Some(stamp) = &meta.created {
            builder.created = Some(match builder.created.take() {
                Some(current) => earlier(&current, stamp),
                None => stamp.clone(),
            });
            builder.updated = Some(match builder.updated.take() {
                Some(current) => later(&current, stamp),
                None => stamp.clone(),
            });
        }
        if let Some(model) = &meta.model {
            let canonical = pricing::canonical_model(model);
            builder.models.insert(canonical.clone());
            if meta.role == "assistant" {
                builder.usage.input = builder.usage.input.saturating_add(meta.input);
                builder.usage.output = builder.usage.output.saturating_add(meta.output);
                builder.usage.cache_read = builder.usage.cache_read.saturating_add(meta.cache_read);
                builder.usage.cache_write =
                    builder.usage.cache_write.saturating_add(meta.cache_write);
                let cost = pricing::estimate(
                    &canonical,
                    meta.input,
                    meta.output,
                    meta.cache_read,
                    meta.cache_write,
                )
                .or(meta.cost.filter(|cost| *cost > 0.0));
                if let Some(cost) = cost {
                    builder.usage.cost = Some(builder.usage.cost.unwrap_or(0.0) + cost);
                    builder.known_cost = true;
                }
                if let Some(stamp) = &meta.created {
                    usage_days.add(stamp, meta.input, meta.output, meta.cache_read, meta.cache_write, cost);
                }
            }
        } else if meta.role == "assistant" {
            builder.usage.input = builder.usage.input.saturating_add(meta.input);
            builder.usage.output = builder.usage.output.saturating_add(meta.output);
            builder.usage.cache_read = builder.usage.cache_read.saturating_add(meta.cache_read);
            builder.usage.cache_write = builder.usage.cache_write.saturating_add(meta.cache_write);
            if let Some(stamp) = &meta.created {
                usage_days.add(stamp, meta.input, meta.output, meta.cache_read, meta.cache_write, None);
            }
        }
    }

    let first_user = metas.iter().find(|meta| meta.role == "user");
    let first_assistant = metas.iter().find(|meta| meta.role == "assistant");
    let user_text = first_user.and_then(|meta| first_text_part(root, &meta.id));
    let assistant_text = first_assistant.and_then(|meta| first_text_part(root, &meta.id));
    let title = builder
        .title
        .clone()
        .filter(|title| {
            !matches!(
                title.as_str(),
                "New session" | "Untitled" | "Untitled session"
            )
        })
        .or_else(|| user_text.as_deref().map(|text| excerpt(text, 76)))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Untitled OpenCode session".to_string());
    let excerpt_text = assistant_text
        .as_deref()
        .or(user_text.as_deref())
        .map(|text| excerpt(text, 168))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "A local OpenCode conversation.".to_string());

    if with_messages {
        for meta in &metas {
            build_messages(&mut builder, root, meta, &cwd);
        }
    }

    if !builder.known_cost {
        builder.usage.cost = None;
    } else if let Some(cost) = builder.usage.cost {
        builder.usage.cost = Some((cost * 10_000.0).round() / 10_000.0);
    }
    let usage = if !builder.usage.is_empty() || builder.usage.cost.unwrap_or(0.0) > 0.0 {
        Some(builder.usage.clone())
    } else {
        None
    };
    let tokens = usage.as_ref().map(UsageBreakdown::tokens).unwrap_or(0);
    let mut models: Vec<String> = builder.models.into_iter().collect();
    models.sort();
    let model = models.first().cloned();
    let updated = builder.updated.clone().unwrap_or_else(iso_now);
    let created = builder.created.clone().unwrap_or_else(|| updated.clone());

    Ok(ParsedSession {
        summary: SessionSummary {
            id: builder.id,
            agent: AgentId::Opencode,
            title,
            excerpt: excerpt_text,
            project,
            project_label,
            project_root: String::new(),
            project_root_label: String::new(),
            cwd: crate::util::display_path(Path::new(&cwd)),
            branch: None,
            created_at: created,
            updated_at: updated,
            message_count: builder.message_count,
            tokens,
            size_bytes: session_size(root, &id, path),
            model,
            models,
            usage,
            usage_days: usage_days.into_vec(),
            format: "json".to_string(),
            path: path.to_string_lossy().to_string(),
            deletable: true,
            tint,
            icon,
        },
        messages: builder.messages,
    })
}

fn parse_message_meta(message: &Value, path: &Path) -> MessageMeta {
    let id = message
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("message")
                .to_string()
        });
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("assistant")
        .to_string();
    let created = message
        .get("time")
        .and_then(|time| time.get("created"))
        .and_then(parse_time);
    let model = message
        .get("modelID")
        .and_then(Value::as_str)
        .or_else(|| {
            message
                .get("model")
                .and_then(|model| model.get("modelID"))
                .and_then(Value::as_str)
        })
        .or_else(|| message.get("model").and_then(Value::as_str))
        .map(str::to_string);
    let tokens = message.get("tokens");
    let input = tokens
        .and_then(|tokens| tokens.get("input"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = tokens
        .and_then(|tokens| tokens.get("output"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_read = tokens
        .and_then(|tokens| tokens.get("cache"))
        .and_then(|cache| cache.get("read"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cache_write = tokens
        .and_then(|tokens| tokens.get("cache"))
        .and_then(|cache| cache.get("write"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cost = message.get("cost").and_then(Value::as_f64);
    MessageMeta {
        id,
        role,
        created,
        model,
        input,
        output,
        cache_read,
        cache_write,
        cost,
    }
}

fn build_messages(builder: &mut Builder, root: &Path, meta: &MessageMeta, fallback_stamp: &str) {
    let part_dir = root.join("part").join(&meta.id);
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_messages: Vec<Message> = Vec::new();
    let stamp = meta.created.clone().unwrap_or_else(|| {
        builder
            .updated
            .clone()
            .unwrap_or_else(|| fallback_stamp.to_string())
    });
    let model = meta.model.as_deref().map(pricing::canonical_model);
    let tokens = meta.input + meta.output + meta.cache_read + meta.cache_write;

    if part_dir.is_dir() {
        for part_path in sorted_json_files(&part_dir) {
            let Ok(raw) = fs::read(&part_path) else {
                continue;
            };
            let Ok(part) = serde_json::from_slice::<Value>(&raw) else {
                continue;
            };
            let part_id = part.get("id").and_then(Value::as_str).unwrap_or("part");
            let part_stamp = part
                .get("time")
                .and_then(|time| time.get("start"))
                .and_then(parse_time)
                .or_else(|| {
                    part.get("time")
                        .and_then(|time| time.get("end"))
                        .and_then(parse_time)
                })
                .unwrap_or_else(|| stamp.clone());
            match part.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if !text.trim().is_empty() {
                            text_parts.push(truncate_chars(text, MAX_TEXT));
                        }
                    }
                }
                Some("tool") => {
                    let state = part.get("state").cloned().unwrap_or(Value::Null);
                    let status = state.get("status").and_then(Value::as_str).unwrap_or("ok");
                    let output = state
                        .get("output")
                        .map(|value| match value {
                            Value::String(text) => text.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default();
                    let input = state.get("input").cloned().unwrap_or(Value::Null);
                    let body = if output.trim().is_empty() {
                        serde_json::to_string_pretty(&input).unwrap_or_default()
                    } else {
                        output
                    };
                    let detail = state
                        .get("title")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| compact_input(&input));
                    tool_messages.push(Message {
                        id: part_id.to_string(),
                        role: "tool".to_string(),
                        content: truncate_chars(&body, MAX_TOOL_CONTENT),
                        timestamp: part_stamp,
                        model: model.clone(),
                        tool_name: part.get("tool").and_then(Value::as_str).map(str::to_string),
                        tool_detail: Some(detail),
                        tool_status: Some(
                            if status == "error" { "error" } else { "ok" }.to_string(),
                        ),
                        tokens: None,
                    });
                }
                _ => {}
            }
        }
    }

    if !text_parts.is_empty() {
        builder.messages.push(Message {
            id: meta.id.clone(),
            role: meta.role.clone(),
            content: truncate_chars(&text_parts.join("\n\n"), MAX_TEXT),
            timestamp: stamp.clone(),
            model: if meta.role == "assistant" {
                model.clone()
            } else {
                None
            },
            tool_name: None,
            tool_detail: None,
            tool_status: None,
            tokens: (tokens > 0).then_some(tokens),
        });
    }
    builder.messages.extend(tool_messages);
}

fn first_text_part(root: &Path, message_id: &str) -> Option<String> {
    if !crate::util::is_safe_component(message_id) {
        return None;
    }
    let dir = root.join("part").join(message_id);
    for part_path in sorted_json_files(&dir) {
        let Ok(raw) = fs::read(&part_path) else {
            continue;
        };
        let Ok(part) = serde_json::from_slice::<Value>(&raw) else {
            continue;
        };
        if part.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    return Some(excerpt(text, 240));
                }
            }
        }
    }
    None
}

fn session_size(root: &Path, id: &str, session_path: &Path) -> u64 {
    let mut total = file_size(session_path);
    let message_dir = root.join("message").join(id);
    if message_dir.is_dir() {
        total = total.saturating_add(dir_size(&message_dir));
        for path in sorted_json_files(&message_dir) {
            if let Some(message_id) = path.file_stem().and_then(|stem| stem.to_str()) {
                total = total.saturating_add(dir_size(&root.join("part").join(message_id)));
            }
        }
    }
    total.saturating_add(file_size(&root.join("todo").join(format!("{id}.json"))))
}

fn dir_size(dir: &Path) -> u64 {
    if !dir.is_dir() {
        return 0;
    }
    WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.metadata().map(|meta| meta.len()).unwrap_or(0))
        .sum()
}

pub(super) fn compact_input(input: &Value) -> String {
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
