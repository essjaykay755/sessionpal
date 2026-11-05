use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

use chrono::Local;
use rusqlite::Connection;
use serde::Serialize;
use tauri::Manager;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::agents::{self, RelatedFile};
use crate::models::{
    AgentId, AppPaths, BackupManifest, BackupRecord, ExportBackupResult, ManifestFile,
    RestoreResult, SessionSummary,
};
use crate::paths;
use crate::util::{display_path, iso_now, slugify};

const MANIFEST_NAME: &str = "manifest.json";
const SUMMARY_NAME: &str = "sessions-summary.json";
const README_NAME: &str = "README.txt";
const FORMAT_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ARCHIVE_FILES: usize = 50_000;
const MAX_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the SessionPal data folder: {error}"))
}

pub fn app_paths(app: &tauri::AppHandle) -> Result<AppPaths, String> {
    let app_data = app_data_dir(app)?;
    let backup_dir = app_data.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Could not create the backup folder: {error}"))?;
    Ok(AppPaths {
        app_data_dir: app_data.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
    })
}

/// The app was first released as SessionDen under this bundle identifier, so its
/// backups live in a sibling app-data folder.
const LEGACY_IDENTIFIER: &str = "com.sessionden.desktop";

/// Moves backups made under the old identifier into the current backup folder.
/// Runs at startup; archives that already exist in the new folder are left alone.
pub fn migrate_legacy_backups(app: &tauri::AppHandle) {
    let Ok(app_data) = app_data_dir(app) else {
        return;
    };
    let Some(legacy) = app_data.parent().map(|parent| parent.join(LEGACY_IDENTIFIER).join("backups"))
    else {
        return;
    };
    if let Ok(dir) = backup_dir(app) {
        migrate_backups_between(&legacy, &dir);
    }
}

pub(crate) fn migrate_backups_between(legacy: &Path, current: &Path) -> usize {
    let Ok(entries) = fs::read_dir(legacy) else {
        return 0;
    };
    let mut moved = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("zip") || !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name() else { continue };
        let target = current.join(name);
        if target.exists() {
            continue;
        }
        // Rename when both folders share a volume; otherwise copy and keep the original.
        if fs::rename(&path, &target).is_ok() || fs::copy(&path, &target).is_ok() {
            moved += 1;
        }
    }
    moved
}

pub fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("backups");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the backup folder: {error}"))?;
    Ok(dir)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryEntry {
    id: String,
    agent: AgentId,
    title: String,
    project: String,
    updated_at: String,
    tokens: u64,
    model: Option<String>,
}

struct PayloadFile {
    source: PathBuf,
    original: PathBuf,
    relative: Option<String>,
    agent: AgentId,
    kind: String,
    session_id: Option<String>,
}

struct TempGuard {
    path: PathBuf,
}

impl TempGuard {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
        let _ = fs::remove_file(&self.path);
    }
}

pub fn create_backup(
    app: &tauri::AppHandle,
    name: String,
    selected_agents: Vec<AgentId>,
) -> Result<BackupRecord, String> {
    let dir = backup_dir(app)?;
    create_backup_in(
        &dir,
        name,
        selected_agents,
        agents::list_sessions(),
        &paths::existing_roots(),
    )
}

pub(crate) fn create_backup_in(
    dir: &Path,
    name: String,
    selected_agents: Vec<AgentId>,
    all_sessions: Vec<SessionSummary>,
    roots: &paths::AgentRoots,
) -> Result<BackupRecord, String> {
    let agents_set: HashSet<AgentId> = selected_agents.iter().copied().collect();
    let mut agents: Vec<AgentId> = selected_agents;
    agents.sort();
    agents.dedup();

    let sessions: Vec<SessionSummary> = all_sessions
        .into_iter()
        .filter(|session| agents_set.contains(&session.agent))
        .collect();
    if sessions.is_empty() {
        return Err("No sessions matched the selected agents.".to_string());
    }

    let mut payload: Vec<PayloadFile> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for session in &sessions {
        let related = agents::related_files_for(session)?;
        for file in related {
            let canonical = validate_payload_file(&file, session.agent, roots)?;
            if !seen.insert(canonical.clone()) {
                continue;
            }
            let relative = relative_to_root(&canonical, session.agent, roots);
            payload.push(PayloadFile {
                source: canonical.clone(),
                original: canonical,
                relative,
                agent: session.agent,
                kind: file.kind,
                session_id: file.session_id,
            });
        }
    }
    if payload.is_empty() {
        return Err("No readable session files were found.".to_string());
    }
    payload.sort_by(|a, b| {
        a.agent
            .cmp(&b.agent)
            .then_with(|| a.original.cmp(&b.original))
    });

    let id = Uuid::new_v4().to_string();
    let created_at = iso_now();
    let name = {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            format!("Backup · {}", Local::now().format("%b %-d, %Y"))
        } else {
            trimmed.to_string()
        }
    };
    let archive_names = archive_names(&payload);
    let files: Vec<ManifestFile> = payload
        .iter()
        .zip(archive_names.iter())
        .map(|(file, archive_path)| ManifestFile {
            archive_path: archive_path.clone(),
            original_path: file.original.to_string_lossy().to_string(),
            agent: file.agent,
            kind: file.kind.clone(),
            session_id: file.session_id.clone(),
            relative_path: file.relative.clone(),
        })
        .collect();
    let manifest = BackupManifest {
        format_version: FORMAT_VERSION,
        created_by: "SessionPal".to_string(),
        id: id.clone(),
        name: name.clone(),
        created_at: created_at.clone(),
        agents: agents.clone(),
        session_count: sessions.len() as u64,
        file_count: (files.len() + 3) as u64,
        files,
    };

    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let filename = format!(
        "sessionpal-{}-{}-{}.zip",
        slugify(&name),
        stamp,
        &id[..8.min(id.len())]
    );
    let final_path = dir.join(filename);
    let temp_path = dir.join(format!(".sessionpal-{id}.tmp"));
    let result = write_archive(
        &temp_path,
        &payload,
        &archive_names,
        &manifest,
        &sessions,
        dir,
        &id,
    );
    if let Err(error) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    fs::rename(&temp_path, &final_path)
        .map_err(|error| format!("Could not finalize the backup archive: {error}"))?;
    let size_bytes = fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);

    Ok(BackupRecord {
        id,
        name,
        created_at,
        size_bytes,
        session_count: sessions.len() as u64,
        agents,
        file_count: (payload.len() + 3) as u64,
        path: final_path.to_string_lossy().to_string(),
        demo: None,
    })
}

/// The file's path below the agent root it lives in, using `/` separators.
fn relative_to_root(path: &Path, agent: AgentId, roots: &paths::AgentRoots) -> Option<String> {
    if matches!(agent, AgentId::Cursor | AgentId::Antigravity) {
        return None;
    }
    roots.existing().for_agent(agent).iter().find_map(|root| {
        let root = fs::canonicalize(root).ok()?;
        let relative = path.strip_prefix(&root).ok()?;
        let parts: Option<Vec<&str>> = relative
            .components()
            .map(|component| match component {
                Component::Normal(part) => part.to_str(),
                _ => None,
            })
            .collect();
        parts.filter(|parts| !parts.is_empty()).map(|parts| parts.join("/"))
    })
}

fn validate_payload_file(
    file: &RelatedFile,
    agent: AgentId,
    roots: &paths::AgentRoots,
) -> Result<PathBuf, String> {
    if agent == AgentId::Cursor {
        let canonical = paths::canonical_existing(&file.path)?;
        let is_database = roots
            .cursor
            .iter()
            .filter_map(|root| fs::canonicalize(root).ok())
            .any(|root| root == canonical);
        if !is_database {
            return Err("Refused to back up an unrecognized Cursor database.".to_string());
        }
        return Ok(canonical);
    }
    paths::validate_session_path(agent, &file.path, roots)
}

fn archive_names(payload: &[PayloadFile]) -> Vec<String> {
    payload
        .iter()
        .enumerate()
        .map(|(index, file)| {
            let raw = file
                .source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file.dat");
            let safe: String = raw
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                        character
                    } else {
                        '_'
                    }
                })
                .collect();
            let safe = if safe.trim_matches('.').is_empty() {
                "file.dat".to_string()
            } else {
                safe
            };
            format!("files/{:05}-{}", index + 1, safe)
        })
        .collect()
}

fn write_archive(
    temp_path: &Path,
    payload: &[PayloadFile],
    archive_names: &[String],
    manifest: &BackupManifest,
    sessions: &[SessionSummary],
    dir: &Path,
    backup_id: &str,
) -> Result<(), String> {
    let file = File::create(temp_path)
        .map_err(|error| format!("Could not create the backup archive: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let readme = format!(
        "SessionPal backup\n=================\n\n\
         Archive: {}\nCreated: {}\nSessions: {}\nAgents: {}\n\n\
         This archive contains the original agent session files plus a manifest\n\
         describing where each file belongs. Restores are staged, fully validated,\n\
         and create a safety backup before replacing anything.\n\n\
         No data left this device.\n",
        manifest.name,
        manifest.created_at,
        manifest.session_count,
        manifest
            .agents
            .iter()
            .map(|agent| agent.name())
            .collect::<Vec<_>>()
            .join(", ")
    );
    add_bytes(&mut zip, README_NAME, readme.as_bytes(), options)?;

    let summary = SummaryEntryList {
        exported_by: "SessionPal",
        sessions: sessions
            .iter()
            .map(|session| SummaryEntry {
                id: session.id.clone(),
                agent: session.agent,
                title: session.title.clone(),
                project: session.project.clone(),
                updated_at: session.updated_at.clone(),
                tokens: session.tokens,
                model: session.model.clone(),
            })
            .collect(),
    };
    let summary_json = serde_json::to_vec_pretty(&summary)
        .map_err(|error| format!("Could not serialize the backup index: {error}"))?;
    add_bytes(&mut zip, SUMMARY_NAME, &summary_json, options)?;

    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Could not serialize the backup manifest: {error}"))?;
    add_bytes(&mut zip, MANIFEST_NAME, &manifest_json, options)?;

    for (file, archive_path) in payload.iter().zip(archive_names.iter()) {
        if file.kind == "cursor-chats" {
            let snapshot = dir.join(format!(".sessionpal-{backup_id}-cursor.vscdb"));
            let _guard = TempGuard::new(snapshot.clone());
            snapshot_cursor_chats(&file.source, &snapshot)?;
            add_file(&mut zip, archive_path, &snapshot, options)?;
        } else if file.kind == "opencode-chats" {
            let snapshot = dir.join(format!(".sessionpal-{backup_id}-opencode.db"));
            let _guard = TempGuard::new(snapshot.clone());
            crate::agents::opencode_db::snapshot_chats(&file.source, &snapshot)?;
            add_file(&mut zip, archive_path, &snapshot, options)?;
        } else if file.kind.starts_with("antigravity-") {
            let snapshot = dir.join(format!(".sessionpal-{backup_id}-antigravity.db"));
            let _guard = TempGuard::new(snapshot.clone());
            crate::agents::antigravity::snapshot(&file.kind, &file.source, &snapshot)?;
            add_file(&mut zip, archive_path, &snapshot, options)?;
        } else {
            add_file(&mut zip, archive_path, &file.source, options)?;
        }
    }

    zip.finish()
        .map_err(|error| format!("Could not finish the backup archive: {error}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryEntryList<'a> {
    exported_by: &'a str,
    sessions: Vec<SummaryEntry>,
}

fn add_bytes(
    zip: &mut ZipWriter<File>,
    name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| format!("Could not write {name} to the archive: {error}"))?;
    zip.write_all(bytes)
        .map_err(|error| format!("Could not write {name} to the archive: {error}"))
}

fn add_file(
    zip: &mut ZipWriter<File>,
    name: &str,
    path: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options).map_err(|error| {
        format!(
            "Could not add {} to the archive: {error}",
            display_path(path)
        )
    })?;
    let mut source = File::open(path)
        .map_err(|error| format!("Could not read {}: {error}", display_path(path)))?;
    io::copy(&mut source, zip)
        .map_err(|error| format!("Could not archive {}: {error}", display_path(path)))?;
    Ok(())
}

/// Copies only Cursor's chat rows into a fresh database. Cursor's `state.vscdb`
/// also holds settings, extension state and sign-in tokens (in `ItemTable`),
/// none of which belong in a portable archive.
pub(crate) fn snapshot_cursor_chats(source: &Path, destination: &Path) -> Result<(), String> {
    let source_connection = crate::agents::sqlite::open_read_only(source, "Cursor")?;
    let mut destination_connection = Connection::open(destination)
        .map_err(|error| format!("Could not prepare the Cursor snapshot: {error}"))?;
    let failed = |error: rusqlite::Error| format!("Could not snapshot Cursor chats: {error}");
    destination_connection
        .execute_batch("CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);")
        .map_err(failed)?;
    let transaction = destination_connection.transaction().map_err(failed)?;
    {
        let mut insert = transaction
            .prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?1, ?2)")
            .map_err(failed)?;
        // A single statement reads from one consistent snapshot of the live database.
        let mut select = source_connection
            .prepare(
                "SELECT key, value FROM cursorDiskKV \
                 WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%'",
            )
            .map_err(failed)?;
        let mut rows = select.query([]).map_err(failed)?;
        while let Some(row) = rows.next().map_err(failed)? {
            let key: String = row.get(0).map_err(failed)?;
            let value: rusqlite::types::Value = row.get(1).map_err(failed)?;
            insert
                .execute(rusqlite::params![key, value])
                .map_err(failed)?;
        }
    }
    transaction.commit().map_err(failed)?;
    Ok(())
}

pub fn list_backups(app: &tauri::AppHandle) -> Result<Vec<BackupRecord>, String> {
    let dir = backup_dir(app)?;
    let mut records = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(records);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
            continue;
        }
        let Ok(manifest) = read_manifest(&path) else {
            continue;
        };
        records.push(record_from_manifest(&path, &manifest));
    }
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

fn record_from_manifest(path: &Path, manifest: &BackupManifest) -> BackupRecord {
    BackupRecord {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        created_at: manifest.created_at.clone(),
        size_bytes: fs::metadata(path).map(|meta| meta.len()).unwrap_or(0),
        session_count: manifest.session_count,
        agents: manifest.agents.clone(),
        file_count: manifest.file_count,
        path: path.to_string_lossy().to_string(),
        demo: None,
    }
}

pub(crate) fn read_manifest(path: &Path) -> Result<BackupManifest, String> {
    let file = File::open(path).map_err(|error| format!("Could not open backup: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Backup archive is unreadable: {error}"))?;
    let entry = archive
        .by_name(MANIFEST_NAME)
        .map_err(|_| "Backup archive has no manifest.".to_string())?;
    let mut text = String::new();
    entry
        .take(MAX_MANIFEST_BYTES)
        .read_to_string(&mut text)
        .map_err(|error| format!("Could not read the backup manifest: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("Backup manifest is invalid: {error}"))
}

fn find_backup(app: &tauri::AppHandle, id: &str) -> Result<(PathBuf, BackupManifest), String> {
    let dir = backup_dir(app)?;
    let entries =
        fs::read_dir(&dir).map_err(|error| format!("Could not read the backup folder: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
            continue;
        }
        let Ok(manifest) = read_manifest(&path) else {
            continue;
        };
        if manifest.id == id
            || path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem == id)
                .unwrap_or(false)
        {
            return Ok((path, manifest));
        }
    }
    Err("Backup not found. It may have been moved or removed.".to_string())
}

pub fn delete_backup(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let dir = backup_dir(app)?;
    let (path, _) = find_backup(app, id)?;
    let dir_canonical = fs::canonicalize(&dir)
        .map_err(|error| format!("Could not resolve the backup folder: {error}"))?;
    let path_canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Could not resolve the backup archive: {error}"))?;
    if !path_canonical.starts_with(&dir_canonical) {
        return Err("Refused to delete an archive outside the backup folder.".to_string());
    }
    fs::remove_file(&path_canonical)
        .map_err(|error| format!("Could not delete the backup: {error}"))
}

pub fn export_backup(
    app: &tauri::AppHandle,
    id: &str,
    destination: &Path,
) -> Result<ExportBackupResult, String> {
    let (path, _) = find_backup(app, id)?;
    if destination.as_os_str().is_empty() {
        return Err("Choose a destination for the backup archive.".to_string());
    }
    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create the destination folder: {error}"))?;
        }
    }
    fs::copy(&path, destination)
        .map_err(|error| format!("Could not export the backup: {error}"))?;
    let size_bytes = fs::metadata(destination)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(ExportBackupResult {
        destination: destination.to_string_lossy().to_string(),
        size_bytes,
    })
}

struct RestoreEntry {
    archive_path: String,
    original: PathBuf,
}

struct RestorePlan {
    entries: Vec<RestoreEntry>,
    /// Cursor entries. Cursor's live database is never written to.
    read_only: u64,
}

enum FileOutcome {
    Restored,
    Unchanged,
    KeptLocal,
}

pub fn restore_backup(app: &tauri::AppHandle, id: &str) -> Result<RestoreResult, String> {
    let dir = backup_dir(app)?;
    let (archive_path, manifest) = find_backup(app, id)?;
    restore_archive(&dir, &archive_path, &manifest, &paths::candidate_roots())
}

/// Restores only files that are missing on disk. An existing file is never
/// replaced: if it differs from the archived copy it is kept as-is, because the
/// local copy is usually a session that continued after the backup was made.
pub(crate) fn restore_archive(
    staging_parent: &Path,
    archive_path: &Path,
    manifest: &BackupManifest,
    roots: &paths::AgentRoots,
) -> Result<RestoreResult, String> {
    if manifest.format_version != FORMAT_VERSION {
        return Err(format!(
            "This backup uses format version {}. This build supports version {FORMAT_VERSION}.",
            manifest.format_version
        ));
    }
    let plan = validate_manifest(manifest, roots)?;
    let mut result = RestoreResult {
        skipped_read_only: plan.read_only,
        ..RestoreResult::default()
    };
    if plan.entries.is_empty() {
        if plan.read_only > 0 {
            return Ok(result);
        }
        return Err("The backup contains no restorable files.".to_string());
    }

    let staging = staging_parent.join(format!(".sessionpal-restore-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not create the restore staging folder: {error}"))?;
    let _staging_guard = TempGuard::new(staging.clone());

    extract_archive(archive_path, &plan.entries, &staging)?;

    for entry in &plan.entries {
        let staged = staging.join(&entry.archive_path);
        match restore_missing_file(&staged, &entry.original) {
            Ok(FileOutcome::Restored) => result.restored += 1,
            Ok(FileOutcome::Unchanged) => result.unchanged += 1,
            Ok(FileOutcome::KeptLocal) => result.kept_local += 1,
            Err(error) => result.errors.push(error),
        }
    }
    Ok(result)
}

fn validate_manifest(
    manifest: &BackupManifest,
    roots: &paths::AgentRoots,
) -> Result<RestorePlan, String> {
    if manifest.files.len() > MAX_ARCHIVE_FILES {
        return Err("The backup contains too many files to restore safely.".to_string());
    }
    let mut plan = RestorePlan {
        entries: Vec::new(),
        read_only: 0,
    };
    let mut archive_seen: HashSet<String> = HashSet::new();
    let mut original_seen: HashSet<PathBuf> = HashSet::new();

    for file in &manifest.files {
        if file.archive_path.is_empty() {
            return Err("The backup manifest contains an empty archive path.".to_string());
        }
        let relative = Path::new(&file.archive_path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
            || !relative.starts_with("files")
        {
            return Err("The backup manifest contains an unsafe archive path.".to_string());
        }
        let normalized_archive = relative.to_string_lossy().to_string();
        if !archive_seen.insert(normalized_archive.clone()) {
            return Err("The backup manifest contains duplicate archive entries.".to_string());
        }

        let kind_ok = match (file.agent, file.kind.as_str()) {
            // Older archives hold the whole database, newer ones only chat rows.
            (AgentId::Cursor, "cursor-db") | (AgentId::Cursor, "cursor-chats") => {
                plan.read_only += 1;
                continue;
            }
            // A snapshot of OpenCode's database: kept in the archive, never written back.
            (AgentId::Opencode, "opencode-chats") => {
                plan.read_only += 1;
                continue;
            }
            // Antigravity snapshots: kept in the archive, never written back.
            (AgentId::Antigravity, "antigravity-index" | "antigravity-conversation") => {
                plan.read_only += 1;
                continue;
            }
            (AgentId::Claude, "session") => true,
            (AgentId::Codex, "session") => true,
            (AgentId::Opencode, "session") => true,
            (AgentId::Opencode, "opencode-message") => true,
            (AgentId::Opencode, "opencode-part") => true,
            (AgentId::Opencode, "opencode-todo") => true,
            _ => false,
        };
        if !kind_ok {
            return Err(format!(
                "The backup contains an unsupported {} entry.",
                file.kind
            ));
        }

        let validated = restore_target(file, roots)?;
        if !original_seen.insert(validated.clone()) {
            return Err("The backup manifest contains duplicate restore targets.".to_string());
        }
        plan.entries.push(RestoreEntry {
            archive_path: normalized_archive,
            original: validated,
        });
    }
    Ok(plan)
}

/// Uses the recorded absolute path when it belongs to an agent root on this
/// machine. Otherwise the file is relocated under this machine's agent root, so
/// archives from another computer or user account can still be restored.
fn restore_target(file: &ManifestFile, roots: &paths::AgentRoots) -> Result<PathBuf, String> {
    let original = PathBuf::from(&file.original_path);
    let direct = paths::validate_restore_target(file.agent, &file.kind, &original, roots);
    if direct.is_ok() {
        return direct;
    }
    let relative = file
        .relative_path
        .as_deref()
        .and_then(safe_relative_parts)
        .or_else(|| derive_relative(&file.original_path, file.agent, roots));
    let Some(relative) = relative else {
        return direct;
    };
    // Prefer a root that already exists; otherwise the agent's default location.
    let candidates = roots.for_agent(file.agent);
    let ordered = candidates
        .iter()
        .filter(|root| root.exists())
        .chain(candidates.iter().filter(|root| !root.exists()));
    for root in ordered {
        let mut target = root.clone();
        for part in &relative {
            target.push(part);
        }
        if let Ok(validated) = paths::validate_restore_target(file.agent, &file.kind, &target, roots) {
            return Ok(validated);
        }
    }
    direct
}

fn safe_relative_parts(relative: &str) -> Option<Vec<String>> {
    let parts: Vec<String> = relative
        .split(['/', '\\'])
        .map(str::to_string)
        .collect();
    let safe = !parts.is_empty()
        && parts
            .iter()
            .all(|part| !part.is_empty() && part != "." && part != ".." && !part.contains(':'));
    safe.then_some(parts)
}

/// Older archives only record absolute paths. Find where this machine's agent
/// root (for example `.claude/projects`) appears in the recorded path and keep
/// what follows it.
fn derive_relative(original: &str, agent: AgentId, roots: &paths::AgentRoots) -> Option<Vec<String>> {
    let parts: Vec<&str> = original.split(['/', '\\']).filter(|part| !part.is_empty()).collect();
    for tail_len in [2usize, 1] {
        for root in roots.for_agent(agent) {
            let root_parts: Vec<&str> = root
                .components()
                .filter_map(|component| match component {
                    Component::Normal(part) => part.to_str(),
                    _ => None,
                })
                .collect();
            if root_parts.len() < tail_len {
                continue;
            }
            let tail = &root_parts[root_parts.len() - tail_len..];
            let found = (0..parts.len().saturating_sub(tail_len))
                .rev()
                .find(|&start| &parts[start..start + tail_len] == tail);
            if let Some(start) = found {
                let rest = parts[start + tail_len..].join("/");
                if let Some(relative) = safe_relative_parts(&rest) {
                    return Some(relative);
                }
            }
        }
    }
    None
}

/// Copies an archive chosen by the user into the backup folder after checking
/// that it is a SessionPal backup this build understands.
pub fn import_backup(app: &tauri::AppHandle, source: &Path) -> Result<BackupRecord, String> {
    let dir = backup_dir(app)?;
    import_backup_into(&dir, source)
}

pub(crate) fn import_backup_into(dir: &Path, source: &Path) -> Result<BackupRecord, String> {
    let manifest = read_manifest(source)?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(format!(
            "This backup uses format version {}. This build supports version {FORMAT_VERSION}.",
            manifest.format_version
        ));
    }
    let file = File::open(source).map_err(|error| format!("Could not open the backup: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Backup archive is unreadable: {error}"))?;
    for entry in &manifest.files {
        let relative = Path::new(&entry.archive_path);
        let safe = !relative.is_absolute()
            && relative.starts_with("files")
            && relative
                .components()
                .all(|component| matches!(component, Component::Normal(_)));
        if !safe || archive.by_name(&entry.archive_path).is_err() {
            return Err("This archive's manifest does not match its contents.".to_string());
        }
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
                continue;
            }
            if read_manifest(&path).map(|existing| existing.id == manifest.id).unwrap_or(false) {
                return Err(format!("“{}” is already in your backups.", manifest.name));
            }
        }
    }

    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(slugify)
        .unwrap_or_else(|| "imported-backup".to_string());
    let mut target = dir.join(format!("{stem}.zip"));
    let mut suffix = 2;
    while target.exists() {
        target = dir.join(format!("{stem}-{suffix}.zip"));
        suffix += 1;
    }
    let temp = dir.join(format!(".sessionpal-import-{}.tmp", Uuid::new_v4()));
    let _guard = TempGuard::new(temp.clone());
    fs::copy(source, &temp).map_err(|error| format!("Could not import the backup: {error}"))?;
    fs::rename(&temp, &target).map_err(|error| format!("Could not import the backup: {error}"))?;
    Ok(record_from_manifest(&target, &manifest))
}

fn extract_archive(
    archive_path: &Path,
    entries: &[RestoreEntry],
    staging: &Path,
) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|error| format!("Could not open the backup: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Backup archive is unreadable: {error}"))?;
    let mut total_bytes = 0u64;
    let staging_canonical = fs::canonicalize(staging)
        .map_err(|error| format!("Could not resolve the staging folder: {error}"))?;

    for entry in entries {
        let mut file = archive.by_name(&entry.archive_path).map_err(|_| {
            format!(
                "The backup is missing its archived file for {}.",
                display_path(&entry.original)
            )
        })?;
        if file.is_dir() {
            return Err("The backup contains a folder where a file was expected.".to_string());
        }
        if let Some(mode) = file.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err(
                    "The backup contains a symbolic link, which SessionPal will not restore."
                        .to_string(),
                );
            }
        }
        let size = file.size();
        if size > MAX_SINGLE_FILE_BYTES {
            return Err("The backup contains an unreasonably large file.".to_string());
        }
        total_bytes = total_bytes.saturating_add(size);
        if total_bytes > MAX_ARCHIVE_BYTES {
            return Err("The backup expands beyond the safe restore limit.".to_string());
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "The backup contains a path outside its archive.".to_string())?;
        let target = staging_canonical.join(&enclosed);
        if !target.starts_with(&staging_canonical) {
            return Err("The backup contains a path outside the staging folder.".to_string());
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not stage the backup: {error}"))?;
        }
        let mut output = File::create(&target)
            .map_err(|error| format!("Could not stage the backup: {error}"))?;
        // The declared size is only a claim; never write more than it.
        let written = io::copy(&mut (&mut file).take(size.saturating_add(1)), &mut output)
            .map_err(|error| format!("Could not extract the backup: {error}"))?;
        if written != size {
            return Err("The backup contains a file whose size does not match its header.".to_string());
        }
    }
    Ok(())
}

fn restore_missing_file(staged: &Path, target: &Path) -> Result<FileOutcome, String> {
    match fs::symlink_metadata(target) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(format!(
                "Refusing to restore over the symbolic link {}.",
                display_path(target)
            ))
        }
        Ok(meta) if meta.is_dir() => {
            return Err(format!(
                "Refusing to replace the folder {} with a file.",
                display_path(target)
            ))
        }
        Ok(_) => {
            return if files_identical(staged, target)? {
                Ok(FileOutcome::Unchanged)
            } else {
                Ok(FileOutcome::KeptLocal)
            };
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("Could not inspect {}: {error}", display_path(target)))
        }
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", display_path(parent)))?;
    }
    // create_new never replaces a file that appeared since the check above.
    let mut output = match fs::OpenOptions::new().write(true).create_new(true).open(target) {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Ok(FileOutcome::KeptLocal)
        }
        Err(error) => return Err(format!("Could not write {}: {error}", display_path(target))),
    };
    let copied = File::open(staged)
        .and_then(|mut source| io::copy(&mut source, &mut output))
        .and_then(|_| output.sync_all());
    if let Err(error) = copied {
        drop(output);
        let _ = fs::remove_file(target);
        return Err(format!("Could not restore {}: {error}", display_path(target)));
    }
    Ok(FileOutcome::Restored)
}

fn files_identical(a: &Path, b: &Path) -> Result<bool, String> {
    let read_error = |error: io::Error| format!("Could not compare restore files: {error}");
    if fs::metadata(a).map_err(read_error)?.len() != fs::metadata(b).map_err(read_error)?.len() {
        return Ok(false);
    }
    let mut left = io::BufReader::new(File::open(a).map_err(read_error)?);
    let mut right = io::BufReader::new(File::open(b).map_err(read_error)?);
    let mut left_buffer = [0u8; 64 * 1024];
    let mut right_buffer = [0u8; 64 * 1024];
    loop {
        let read = left.read(&mut left_buffer).map_err(read_error)?;
        if read == 0 {
            return Ok(true);
        }
        right.read_exact(&mut right_buffer[..read]).map_err(read_error)?;
        if left_buffer[..read] != right_buffer[..read] {
            return Ok(false);
        }
    }
}
