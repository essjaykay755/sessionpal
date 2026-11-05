use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::models::AgentId;
use crate::util::display_path;

#[derive(Debug, Clone, Default)]
pub struct AgentRoots {
    pub claude: Vec<PathBuf>,
    pub codex: Vec<PathBuf>,
    pub cursor: Vec<PathBuf>,
    pub opencode: Vec<PathBuf>,
    pub antigravity: Vec<PathBuf>,
}

impl AgentRoots {
    pub fn for_agent(&self, agent: AgentId) -> &[PathBuf] {
        match agent {
            AgentId::Claude => &self.claude,
            AgentId::Codex => &self.codex,
            AgentId::Cursor => &self.cursor,
            AgentId::Opencode => &self.opencode,
            AgentId::Antigravity => &self.antigravity,
        }
    }

    /// Roots that exist, with aliases (symlinks, `$CLAUDE_CONFIG_DIR` pointing at
    /// `~/.claude`, …) collapsed so the same files are never scanned twice.
    pub fn existing(&self) -> AgentRoots {
        fn keep(paths: &[PathBuf]) -> Vec<PathBuf> {
            let mut seen: Vec<PathBuf> = Vec::new();
            let mut kept = Vec::new();
            for path in paths {
                let Ok(canonical) = fs::canonicalize(path) else {
                    continue;
                };
                if !seen.contains(&canonical) {
                    seen.push(canonical);
                    kept.push(path.clone());
                }
            }
            kept
        }
        AgentRoots {
            claude: keep(&self.claude),
            codex: keep(&self.codex),
            cursor: keep(&self.cursor),
            opencode: keep(&self.opencode),
            antigravity: keep(&self.antigravity),
        }
    }

    pub fn display_for(&self, agent: AgentId) -> Vec<String> {
        self.for_agent(agent)
            .iter()
            .map(|path| display_path(path))
            .collect()
    }
}

fn push_unique(target: &mut Vec<PathBuf>, path: PathBuf) {
    let normalized = normalize(&path);
    if !target.iter().any(|item| item == &normalized) {
        target.push(normalized);
    }
}

fn normalize(path: &Path) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            other => output.push(other.as_os_str()),
        }
    }
    output
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Every plausible storage location, including paths that do not exist yet.
/// Existing paths are used for discovery; the full set is used when validating
/// restore targets so a restore still works after an agent was reinstalled.
pub fn candidate_roots() -> AgentRoots {
    let mut roots = AgentRoots::default();

    let mut claude = Vec::new();
    if let Some(config) = env_path("CLAUDE_CONFIG_DIR") {
        push_unique(&mut claude, config.join("projects"));
    }
    if let Some(home) = home() {
        push_unique(&mut claude, home.join(".claude").join("projects"));
        push_unique(
            &mut claude,
            home.join(".config").join("claude").join("projects"),
        );
    }
    roots.claude = claude;

    let mut codex = Vec::new();
    if let Some(home) = env_path("CODEX_HOME") {
        push_unique(&mut codex, home.join("sessions"));
    }
    if let Some(home) = home() {
        push_unique(&mut codex, home.join(".codex").join("sessions"));
    }
    roots.codex = codex;

    let mut cursor = Vec::new();
    if let Some(home) = home() {
        #[cfg(target_os = "macos")]
        {
            for folder in ["Cursor", "Cursor Nightly"] {
                push_unique(
                    &mut cursor,
                    home.join("Library")
                        .join("Application Support")
                        .join(folder)
                        .join("User")
                        .join("globalStorage")
                        .join("state.vscdb"),
                );
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Some(appdata) = env_path("APPDATA") {
                for folder in ["Cursor", "Cursor Nightly"] {
                    push_unique(
                        &mut cursor,
                        appdata
                            .join(folder)
                            .join("User")
                            .join("globalStorage")
                            .join("state.vscdb"),
                    );
                }
            }
            let _ = home;
        }
        #[cfg(target_os = "linux")]
        {
            let config = env_path("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
            for folder in ["Cursor", "Cursor Nightly"] {
                push_unique(
                    &mut cursor,
                    config
                        .join(folder)
                        .join("User")
                        .join("globalStorage")
                        .join("state.vscdb"),
                );
            }
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(appdata) = env_path("APPDATA") {
        for folder in ["Cursor", "Cursor Nightly"] {
            push_unique(
                &mut cursor,
                appdata
                    .join(folder)
                    .join("User")
                    .join("globalStorage")
                    .join("state.vscdb"),
            );
        }
    }
    roots.cursor = cursor;

    // OpenCode data folders. Newer versions keep sessions in `opencode.db`;
    // older ones wrote JSON files under `storage/`.
    let mut opencode_data = Vec::new();
    if let Some(data) = env_path("OPENCODE_DATA_HOME") {
        push_unique(&mut opencode_data, data);
    }
    if let Some(data) = env_path("XDG_DATA_HOME") {
        push_unique(&mut opencode_data, data.join("opencode"));
    }
    if let Some(home) = home() {
        push_unique(&mut opencode_data, home.join(".local").join("share").join("opencode"));
        push_unique(&mut opencode_data, home.join(".opencode"));
        #[cfg(target_os = "macos")]
        push_unique(
            &mut opencode_data,
            home.join("Library").join("Application Support").join("opencode"),
        );
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = env_path("LOCALAPPDATA") {
        push_unique(&mut opencode_data, local.join("opencode"));
    }
    #[cfg(target_os = "windows")]
    if let Some(roaming) = env_path("APPDATA") {
        push_unique(&mut opencode_data, roaming.join("opencode"));
    }
    let mut opencode = Vec::new();
    // OPENCODE_DATA_HOME may also point straight at an old storage folder.
    if let Some(data) = env_path("OPENCODE_DATA_HOME") {
        push_unique(&mut opencode, data);
    }
    for data in &opencode_data {
        push_unique(&mut opencode, data.join(crate::agents::opencode_db::DATABASE_NAME));
        push_unique(&mut opencode, data.join("storage"));
    }
    roots.opencode = opencode;

    // Google Antigravity: an index database next to one database per conversation.
    let mut antigravity = Vec::new();
    if let Some(home) = home() {
        for folder in ["antigravity", "antigravity-ide"] {
            push_unique(
                &mut antigravity,
                home.join(".gemini")
                    .join(folder)
                    .join(crate::agents::antigravity::DATABASE_NAME),
            );
        }
    }
    roots.antigravity = antigravity;

    roots
}

pub fn existing_roots() -> AgentRoots {
    candidate_roots().existing()
}

pub fn canonical_existing(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve {}: {error}", display_path(path)))
}

pub fn path_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// Validates a path that must already exist before SessionPal reads or deletes it.
pub fn validate_session_path(
    agent: AgentId,
    path: &Path,
    roots: &AgentRoots,
) -> Result<PathBuf, String> {
    let canonical = canonical_existing(path)?;
    if !canonical.is_file() {
        return Err(format!("{} is not a file.", display_path(path)));
    }

    let candidates = roots.existing();
    if agent == AgentId::Cursor {
        let is_database = candidates
            .cursor
            .iter()
            .filter_map(|root| fs::canonicalize(root).ok())
            .any(|root| root == canonical);
        if !is_database {
            return Err("Cursor sessions may only be read from a discovered database.".to_string());
        }
        return Ok(canonical);
    }
    if agent == AgentId::Antigravity {
        // The index itself, or a conversation database in the folder beside it.
        let allowed = candidates
            .antigravity
            .iter()
            .filter_map(|root| fs::canonicalize(root).ok())
            .any(|root| {
                root == canonical
                    || (canonical.extension().and_then(|ext| ext.to_str()) == Some("db")
                        && crate::agents::antigravity::conversations_dir(&root)
                            .is_some_and(|dir| canonical.parent() == Some(dir.as_path())))
            });
        if !allowed {
            return Err("Antigravity data may only be read from its discovered storage.".to_string());
        }
        return Ok(canonical);
    }

    let allowed = candidates.for_agent(agent);
    if allowed.is_empty() {
        return Err(format!("No {} storage root was discovered.", agent.name()));
    }
    for root in allowed {
        if let Ok(root) = fs::canonicalize(root) {
            if path_within(&canonical, &root) {
                return Ok(canonical);
            }
        }
    }
    Err(format!(
        "Refused to touch a path outside the discovered {} storage: {}",
        agent.name(),
        display_path(path)
    ))
}

/// Resolves symlinks in the longest existing prefix of an absolute, normalized
/// path and appends the components that do not exist yet.
fn resolve_lenient(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path.to_path_buf();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match fs::canonicalize(&existing) {
            Ok(resolved) => {
                let mut resolved = resolved;
                for component in missing.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(_) => {
                // Something is there but cannot be resolved: a dangling symlink.
                if fs::symlink_metadata(&existing).is_ok() {
                    return Err(format!(
                        "Refusing to follow an unresolvable link at {}",
                        display_path(&existing)
                    ));
                }
                let Some(name) = existing.file_name().map(|name| name.to_os_string()) else {
                    return Err(format!("Could not resolve {}", display_path(path)));
                };
                missing.push(name);
                if !existing.pop() {
                    return Err(format!("Could not resolve {}", display_path(path)));
                }
            }
        }
    }
}

/// Validates a restore destination without requiring the file to exist yet.
pub fn validate_restore_target(
    agent: AgentId,
    kind: &str,
    path: &Path,
    roots: &AgentRoots,
) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!(
            "Refusing non-absolute restore path: {}",
            path.display()
        ));
    }
    let normalized = normalize(path);
    if normalized.parent().is_none() {
        return Err("Refusing to restore over a filesystem root.".to_string());
    }

    let candidates = roots.for_agent(agent);
    // Compare resolved locations, not path text: a symlinked folder inside an
    // agent root must not let a restore write somewhere else.
    let resolved_target = resolve_lenient(&normalized)?;
    let mut allowed = false;
    for root in candidates {
        if let Ok(resolved_root) = resolve_lenient(&normalize(root)) {
            if path_within(&resolved_target, &resolved_root) {
                allowed = true;
                break;
            }
        }
    }
    if !allowed {
        return Err(format!(
            "Refusing to restore a file outside the {} storage roots.",
            agent.name()
        ));
    }

    match (agent, kind) {
        (AgentId::Cursor, _) => {
            return Err("Cursor's database is read-only and is never restored.".to_string());
        }
        (AgentId::Antigravity, _) => {
            return Err("Antigravity's storage is read-only and is never restored.".to_string());
        }
        (AgentId::Claude, _) | (AgentId::Codex, _) => {
            if normalized.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return Err("Agent session archives must restore JSONL files.".to_string());
            }
        }
        (AgentId::Opencode, _) => {
            if normalized.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return Err("OpenCode archives must restore JSON files.".to_string());
            }
        }
    }

    Ok(resolved_target)
}
