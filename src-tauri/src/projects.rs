//! Groups sessions into projects by repository rather than by folder name.
//!
//! `project` (the folder-name slug) stays as it is so existing filters keep
//! working. `project_root` is the folder a session's cost is attributed to:
//! the enclosing git repository when there is one, with linked worktrees
//! mapped back to their main checkout, otherwise the working directory itself.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{FolderAccess, ProjectAccess, SessionSummary};
use crate::util::{display_name, display_path, project_info};

/// Fills `project_root` and `project_root_label` for every session, and the
/// `package.json` display name where folder access allows reading it.
pub fn assign_project_roots(sessions: &mut [SessionSummary], access: &ProjectAccess) {
    let home = dirs::home_dir();
    let mut roots: HashMap<String, Option<(PathBuf, bool)>> = HashMap::new();
    for session in sessions.iter_mut() {
        let root = roots
            .entry(session.cwd.clone())
            .or_insert_with(|| resolve_root(&session.cwd, home.as_deref(), access))
            .clone();
        match root {
            Some((root, readable)) => {
                if readable {
                    let cwd = expand_home(session.cwd.trim(), home.as_deref());
                    if let Some(name) = display_name(&cwd.join("package.json")) {
                        session.project_label = name;
                    }
                }
                session.project_root = display_path(&root);
                let (_, folder_label, _, _) = project_info(&root.to_string_lossy(), &session.project_label);
                session.project_root_label = readable
                    .then(|| display_name(&root.join("package.json")))
                    .flatten()
                    .unwrap_or(folder_label);
            }
            None => {
                // No usable path: group by the folder-name slug, as before.
                session.project_root = String::new();
                session.project_root_label = session.project_label.clone();
            }
        }
    }
    disambiguate_labels(sessions);
}

/// The repository (or folder) a working directory belongs to, and whether
/// its folders may be read. Without access, the folder itself is the root.
fn resolve_root(cwd: &str, home: Option<&Path>, access: &ProjectAccess) -> Option<(PathBuf, bool)> {
    let cleaned = cwd.trim().trim_end_matches(['/', '\\']);
    if cleaned.is_empty() {
        return None;
    }
    let path = expand_home(cleaned, home);
    if !path.is_absolute() || !may_read(&path, home, access) {
        return Some((path, false));
    }
    Some((git_root(&path, home).unwrap_or_else(|| path.clone()), true))
}

fn may_read(path: &Path, home: Option<&Path>, access: &ProjectAccess) -> bool {
    if !access.inspect {
        return false;
    }
    match protected_folder(path, home, cfg!(target_os = "macos")) {
        None => true,
        Some((_, root)) => {
            let root = display_path(&root);
            access.allowed_folders.iter().any(|allowed| allowed == "*" || *allowed == root)
        }
    }
}

/// The macOS privacy-protected folder `path` is inside, if any: reading
/// these needs the user's permission, so they are only read once allowed.
pub(crate) fn protected_folder(path: &Path, home: Option<&Path>, macos: bool) -> Option<(String, PathBuf)> {
    if !macos {
        return None;
    }
    if let Some(home) = home {
        let folders = [
            ("Documents", home.join("Documents")),
            ("Desktop", home.join("Desktop")),
            ("Downloads", home.join("Downloads")),
            ("iCloud Drive", home.join("Library").join("Mobile Documents")),
        ];
        for (name, root) in folders {
            if path.starts_with(&root) {
                return Some((name.to_string(), root));
            }
        }
    }
    // External and network volumes are protected as well.
    let mut parts = path.components();
    parts.next()?;
    if parts.next()?.as_os_str() == "Volumes" {
        let volume = parts.next()?.as_os_str().to_string_lossy().to_string();
        let root = Path::new("/Volumes").join(&volume);
        return Some((volume, root));
    }
    None
}

/// Groups working directories by protected folder. With `request`, each
/// folder is opened once: macOS then asks the user if they have not decided,
/// and the result says whether access was granted.
pub fn folder_access(cwds: &[String], request: bool) -> Vec<FolderAccess> {
    let home = dirs::home_dir();
    let mut folders: Vec<FolderAccess> = Vec::new();
    for cwd in cwds {
        let cleaned = cwd.trim().trim_end_matches(['/', '\\']);
        if cleaned.is_empty() {
            continue;
        }
        let path = expand_home(cleaned, home.as_deref());
        let Some((name, root)) = protected_folder(&path, home.as_deref(), cfg!(target_os = "macos")) else {
            continue;
        };
        let shown = display_path(&root);
        match folders.iter_mut().find(|folder| folder.path == shown) {
            Some(folder) => folder.sessions += 1,
            None => folders.push(FolderAccess {
                name,
                path: shown,
                sessions: 1,
                status: if request { probe(&root) } else { "unknown".to_string() },
            }),
        }
    }
    folders.sort_by(|a, b| b.sessions.cmp(&a.sessions).then_with(|| a.name.cmp(&b.name)));
    folders
}

fn probe(root: &Path) -> String {
    match fs::read_dir(root) {
        Ok(_) => "granted",
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => "denied",
        Err(_) => "unavailable",
    }
    .to_string()
}

fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    if let Some(home) = home {
        if path == "~" {
            return home.to_path_buf();
        }
        if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Walks up from `path` to the nearest folder containing `.git`. Ancestors
/// are checked even when `path` itself no longer exists, so a deleted
/// worktree nested inside its repository still resolves to that repository.
/// The home folder and the filesystem root are never accepted unless they
/// are the working directory itself, so a dotfiles repo in `~` does not
/// swallow every unversioned folder.
pub(crate) fn git_root(path: &Path, home: Option<&Path>) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        let dot_git = ancestor.join(".git");
        let Ok(meta) = fs::symlink_metadata(&dot_git) else {
            continue;
        };
        let is_cwd = ancestor == path;
        let too_broad = ancestor.parent().is_none() || Some(ancestor) == home;
        if too_broad && !is_cwd {
            return None;
        }
        if meta.is_dir() {
            return Some(ancestor.to_path_buf());
        }
        if meta.is_file() {
            return Some(main_checkout(ancestor, &dot_git).unwrap_or_else(|| ancestor.to_path_buf()));
        }
    }
    None
}

/// For a linked worktree, the main checkout its `.git` file points back to.
/// Submodules also use a `.git` file but are projects of their own, so only
/// `…/worktrees/<name>` git directories are followed.
fn main_checkout(worktree: &Path, dot_git: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(dot_git).ok()?;
    let gitdir = content
        .lines()
        .find_map(|line| line.trim().strip_prefix("gitdir:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let gitdir = {
        let gitdir = PathBuf::from(gitdir);
        if gitdir.is_absolute() { gitdir } else { worktree.join(gitdir) }
    };
    if gitdir.parent()?.file_name()? != "worktrees" {
        return None;
    }
    let common = fs::read_to_string(gitdir.join("commondir"))
        .ok()
        .map(|dir| dir.trim().to_string())
        .filter(|dir| !dir.is_empty())
        .map(|dir| {
            let dir = PathBuf::from(dir);
            if dir.is_absolute() { dir } else { gitdir.join(dir) }
        })
        .unwrap_or_else(|| gitdir.parent().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default());
    let common = fs::canonicalize(&common).unwrap_or(common);
    if common.file_name()? == ".git" {
        common.parent().map(Path::to_path_buf)
    } else {
        // A bare repository: the repository folder itself is the project.
        Some(common)
    }
}

/// Two different roots with the same label (`~/work/api`, `~/personal/api`)
/// get their parent folder appended so they can be told apart.
fn disambiguate_labels(sessions: &mut [SessionSummary]) {
    let mut roots_by_label: HashMap<String, HashSet<String>> = HashMap::new();
    for session in sessions.iter() {
        roots_by_label
            .entry(session.project_root_label.clone())
            .or_default()
            .insert(group_key(session));
    }
    for session in sessions.iter_mut() {
        let shared = roots_by_label
            .get(&session.project_root_label)
            .is_some_and(|roots| roots.len() > 1);
        if !shared || session.project_root.is_empty() {
            continue;
        }
        if let Some(parent) = parent_name(&session.project_root) {
            session.project_root_label = format!("{} · {}", session.project_root_label, parent);
        }
    }
}

fn group_key(session: &SessionSummary) -> String {
    if session.project_root.is_empty() {
        format!("slug:{}", session.project)
    } else {
        session.project_root.clone()
    }
}

fn parent_name(root: &str) -> Option<String> {
    let mut parts = root.rsplit(['/', '\\']).filter(|part| !part.is_empty());
    parts.next()?;
    parts.next().map(str::to_owned)
}
