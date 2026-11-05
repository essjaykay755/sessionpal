use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::{
    AgentDetection, AgentId, ProjectAccess, SessionDetail, SessionLocator, SessionSummary,
};
use crate::paths;

pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod cursor;
pub mod opencode;
pub mod opencode_db;
pub mod sqlite;

pub struct ParsedSession {
    pub summary: SessionSummary,
    pub messages: Vec<crate::models::Message>,
}

#[derive(Debug, Clone)]
pub struct RelatedFile {
    pub path: PathBuf,
    pub kind: String,
    pub session_id: Option<String>,
}

pub fn discover() -> Vec<AgentDetection> {
    let roots = paths::existing_roots();
    let mut detections = Vec::new();
    for agent in AgentId::ALL {
        let agent_roots = roots.for_agent(agent);
        let available = !agent_roots.is_empty();
        let session_count = match agent {
            AgentId::Claude => claude::count_sessions(agent_roots),
            AgentId::Codex => codex::count_sessions(agent_roots),
            AgentId::Cursor => cursor::count_sessions(agent_roots),
            AgentId::Opencode => opencode::count_sessions(agent_roots),
            AgentId::Antigravity => antigravity::count_sessions(agent_roots),
        };
        let note = if !available {
            Some("Not found on this device.".to_string())
        } else if matches!(agent, AgentId::Cursor | AgentId::Antigravity)
            || (agent == AgentId::Opencode && agent_roots.iter().any(|root| opencode_db::is_database(root)))
        {
            Some("Read-only database. Sessions can be exported, never deleted.".to_string())
        } else if session_count == 0 {
            Some("Storage was found, but no sessions were detected.".to_string())
        } else {
            None
        };
        detections.push(AgentDetection {
            id: agent,
            name: agent.name().to_string(),
            available,
            roots: roots.display_for(agent),
            session_count,
            note,
        });
    }
    detections
}

/// Scans the chosen agents (all when `agents` is `None`).
pub fn list_sessions(agents: Option<&[AgentId]>, access: &ProjectAccess) -> Vec<SessionSummary> {
    let roots = paths::existing_roots();
    let wanted = |agent: AgentId| agents.map_or(true, |list| list.contains(&agent));
    let mut sessions = Vec::new();
    if wanted(AgentId::Claude) {
        sessions.extend(claude::scan(&roots.claude));
    }
    if wanted(AgentId::Codex) {
        sessions.extend(codex::scan(&roots.codex));
    }
    if wanted(AgentId::Cursor) {
        sessions.extend(cursor::scan(&roots.cursor));
    }
    if wanted(AgentId::Opencode) {
        sessions.extend(opencode::scan(&roots.opencode));
    }
    if wanted(AgentId::Antigravity) {
        sessions.extend(antigravity::scan(&roots.antigravity));
    }
    sessions.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.title.cmp(&b.title))
    });
    make_ids_unique(&mut sessions);
    crate::projects::assign_project_roots(&mut sessions, access);
    sessions
}

const ID_SUFFIX_SEPARATOR: char = '~';

/// The UI keys selection, export and deletion by ID, so IDs must be unique.
/// Two files can carry the same session ID (for example a copied or resumed
/// Claude transcript). Every member of a colliding group gets a suffix derived
/// from its path, so the same file keeps the same ID across rescans.
pub fn make_ids_unique(sessions: &mut [SessionSummary]) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for session in sessions.iter() {
        *counts.entry(session.id.clone()).or_default() += 1;
    }
    for session in sessions.iter_mut() {
        if counts.get(&session.id).copied().unwrap_or(0) > 1 {
            session.id = format!(
                "{}{ID_SUFFIX_SEPARATOR}{:016x}",
                session.id,
                path_hash(&session.path)
            );
        }
    }
}

fn path_hash(path: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

/// Strips the suffix added by [`make_ids_unique`].
pub(crate) fn source_id(id: &str) -> &str {
    match id.rsplit_once(ID_SUFFIX_SEPARATOR) {
        Some((base, suffix))
            if suffix.len() == 16 && suffix.chars().all(|c| c.is_ascii_hexdigit()) =>
        {
            base
        }
        _ => id,
    }
}

pub fn get_session(locator: &SessionLocator) -> Result<SessionDetail, String> {
    let roots = paths::existing_roots();
    let path = PathBuf::from(&locator.path);
    let validated = paths::validate_session_path(locator.agent, &path, &roots)?;
    let mut detail = match locator.agent {
        AgentId::Claude => claude::detail(&validated),
        AgentId::Codex => codex::detail(&validated),
        AgentId::Cursor => cursor::detail(&validated, source_id(&locator.id)),
        AgentId::Opencode if opencode_db::is_database(&validated) => {
            opencode_db::detail(&validated, source_id(&locator.id))
        }
        AgentId::Opencode => opencode::detail(&validated),
        AgentId::Antigravity => antigravity::detail(&validated, source_id(&locator.id)),
    }?;
    // Keep the listing's (possibly disambiguated) ID so the UI can match it.
    detail.summary.id = locator.id.clone();
    // The UI prefers the listing's disambiguated label; this fills the root
    // for callers that only have the detail.
    // Reads nothing on disk; the UI takes the project fields from the listing.
    crate::projects::assign_project_roots(
        std::slice::from_mut(&mut detail.summary),
        &ProjectAccess::default(),
    );
    Ok(detail)
}

pub fn related_files_for(session: &SessionSummary) -> Result<Vec<RelatedFile>, String> {
    let path = PathBuf::from(&session.path);
    match session.agent {
        AgentId::Claude | AgentId::Codex => Ok(vec![RelatedFile {
            path,
            kind: "session".to_string(),
            session_id: Some(session.id.clone()),
        }]),
        AgentId::Cursor => Ok(vec![RelatedFile {
            path,
            kind: "cursor-chats".to_string(),
            session_id: None,
        }]),
        AgentId::Opencode if opencode_db::is_database(&path) => Ok(vec![RelatedFile {
            path,
            kind: "opencode-chats".to_string(),
            session_id: None,
        }]),
        AgentId::Opencode => opencode::related_files(&path),
        AgentId::Antigravity => Ok(antigravity::related_files(&path, source_id(&session.id))),
    }
}

pub fn delete_session(locator: &SessionLocator) -> Result<(), String> {
    if locator.agent == AgentId::Cursor {
        return Err("Cursor sessions are stored in a database and are never deleted.".to_string());
    }
    if locator.agent == AgentId::Antigravity {
        return Err("Antigravity keeps conversations in its own storage, so SessionPal never deletes them.".to_string());
    }
    let roots = paths::existing_roots();
    let path = PathBuf::from(&locator.path);
    let validated = paths::validate_session_path(locator.agent, &path, &roots)?;
    if locator.agent == AgentId::Opencode && opencode_db::is_database(&validated) {
        return Err(
            "OpenCode keeps these sessions in its own database, so SessionPal never deletes them."
                .to_string(),
        );
    }
    match locator.agent {
        AgentId::Claude | AgentId::Codex => crate::util::move_to_trash(&validated),
        AgentId::Opencode => opencode::remove_session(&validated),
        AgentId::Cursor | AgentId::Antigravity => unreachable!(),
    }
}
