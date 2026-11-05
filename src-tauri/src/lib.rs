mod agents;
mod backup;
mod export;
mod models;
mod paths;
mod pricing;
mod projects;
mod scan_cache;
mod search;
mod util;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

use models::{
    AgentDetection, AgentId, AppPaths, BackupRecord, DeleteResult, ExportBackupResult,
    ExportResult, FolderAccess, ProjectAccess, RestoreResult, SessionDetail, SessionLocator,
    SessionSummary,
};

fn task_failed(error: impl std::fmt::Display) -> String {
    format!("Local operation failed: {error}")
}

#[tauri::command]
async fn discover_agents() -> Result<Vec<AgentDetection>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let detections = agents::discover();
        scan_cache::save_detections(&detections);
        detections
    })
    .await
    .map_err(task_failed)
}

#[tauri::command]
async fn list_sessions(
    agents: Option<Vec<AgentId>>,
    access: Option<ProjectAccess>,
) -> Result<Vec<SessionSummary>, String> {
    // Older callers sent no options: scan everything, as before.
    let access = access.unwrap_or_else(ProjectAccess::unrestricted);
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = agents::list_sessions(agents.as_deref(), &access);
        scan_cache::save_sessions(&sessions);
        search::sync_in_background(sessions.clone());
        sessions
    })
    .await
    .map_err(task_failed)
}

/// The library from the last scan, limited to `agents`, so the UI can show it
/// at once while a fresh scan runs. Reads only SessionPal's own cache.
#[tauri::command]
async fn cached_library(agents: Vec<AgentId>) -> Result<Option<scan_cache::LibrarySnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_cache::load_library(&agents))
        .await
        .map_err(task_failed)
}

/// The privacy-protected folders the given working directories live in. With
/// `request`, each folder is opened once, which makes macOS ask the user for
/// access if they have not decided yet; otherwise nothing is read.
#[tauri::command]
async fn project_folders(cwds: Vec<String>, request: bool) -> Result<Vec<FolderAccess>, String> {
    tauri::async_runtime::spawn_blocking(move || projects::folder_access(&cwds, request))
        .await
        .map_err(task_failed)
}

#[tauri::command]
async fn get_session(id: String, agent: AgentId, path: String) -> Result<SessionDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        agents::get_session(&SessionLocator { id, agent, path })
    })
    .await
    .map_err(task_failed)?
}

/// Conversations whose text contains every word of `query`, best match first.
#[tauri::command]
async fn search_sessions(query: String, limit: Option<usize>) -> Result<Vec<search::ContentHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search::search(&query, limit.unwrap_or(200)))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn search_index_status() -> Result<search::IndexStatus, String> {
    tauri::async_runtime::spawn_blocking(search::status)
        .await
        .map_err(task_failed)
}

/// Empties the search index; the next scan rebuilds it.
#[tauri::command]
async fn clear_search_index() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(search::clear)
        .await
        .map_err(task_failed)
}

#[tauri::command]
async fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupRecord>, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::list_backups(&app))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn create_backup(
    app: tauri::AppHandle,
    name: String,
    agents: Vec<AgentId>,
) -> Result<BackupRecord, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::create_backup(&app, name, agents))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, id: String) -> Result<RestoreResult, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::restore_backup(&app, &id))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn delete_backup(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::delete_backup(&app, &id))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn export_backup(
    app: tauri::AppHandle,
    id: String,
    destination: String,
) -> Result<ExportBackupResult, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        backup::export_backup(&app, &id, &PathBuf::from(destination))
    })
    .await
    .map_err(task_failed)?
}

#[tauri::command]
async fn import_backup(app: tauri::AppHandle, source: String) -> Result<BackupRecord, String> {
    tauri::async_runtime::spawn_blocking(move || backup::import_backup(&app, &PathBuf::from(source)))
        .await
        .map_err(task_failed)?
}

#[tauri::command]
async fn delete_sessions(sessions: Vec<SessionLocator>) -> Result<DeleteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = DeleteResult::default();
        for locator in sessions {
            // Sessions inside another app's database are never deleted.
            let in_database = match locator.agent {
                AgentId::Cursor | AgentId::Antigravity => true,
                AgentId::Opencode => agents::opencode_db::is_database(&PathBuf::from(&locator.path)),
                AgentId::Claude | AgentId::Codex => false,
            };
            if in_database {
                result.skipped += 1;
                continue;
            }
            match agents::delete_session(&locator) {
                Ok(()) => result.deleted += 1,
                Err(error) => result.errors.push(format!(
                    "{} · {}: {error}",
                    locator.agent.name(),
                    util::display_path(&PathBuf::from(&locator.path))
                )),
            }
        }
        Ok(result)
    })
    .await
    .map_err(task_failed)?
}

#[tauri::command]
async fn export_sessions(
    sessions: Vec<SessionLocator>,
    format: String,
    destination: String,
) -> Result<ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export::export_sessions(&sessions, &format, &PathBuf::from(destination))
    })
    .await
    .map_err(task_failed)?
}

#[tauri::command]
fn app_paths(app: tauri::AppHandle) -> Result<AppPaths, String> {
    backup::app_paths(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_cache_dir() {
                let _ = std::fs::create_dir_all(&dir);
                search::init(&dir);
                scan_cache::init(dir);
            }
            backup::migrate_legacy_backups(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            discover_agents,
            list_sessions,
            cached_library,
            project_folders,
            get_session,
            search_sessions,
            search_index_status,
            clear_search_index,
            list_backups,
            create_backup,
            restore_backup,
            delete_backup,
            export_backup,
            import_backup,
            delete_sessions,
            export_sessions,
            app_paths,
        ])
        .run(tauri::generate_context!())
        .expect("SessionPal encountered a fatal startup error");
}
