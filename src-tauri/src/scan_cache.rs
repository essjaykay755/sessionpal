//! Cache of parsed session summaries, keyed by source path and invalidated
//! when the size or modification time of any file the source depends on
//! changes. Rescans then only re-read sources that actually changed.
//!
//! Each cache is also saved to the app's cache folder, so the first scan after
//! a restart only re-reads what changed while SessionPal was closed. The saved
//! copy is tagged with the app version and dropped after an update, because a
//! newer parser may summarise the same file differently.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::models::{AgentDetection, AgentId, SessionSummary};

const FORMAT: u32 = 1;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const SESSIONS_FILE: &str = "library-sessions.json";
const DETECTIONS_FILE: &str = "library-agents.json";

static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Sets the folder caches are saved in. Called once at startup; until then
/// (and in tests) caches live in memory only.
pub fn init(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

fn cache_dir() -> Option<&'static Path> {
    CACHE_DIR.get().map(PathBuf::as_path)
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Stamp {
    len: u64,
    /// Nanoseconds since the Unix epoch.
    modified: Option<u64>,
}

impl Stamp {
    fn of(path: &Path) -> Option<Self> {
        let meta = fs::metadata(path).ok()?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|elapsed| u64::try_from(elapsed.as_nanos()).ok());
        Some(Self {
            len: meta.len(),
            modified,
        })
    }
}

/// The state of every file a cached result was built from. A file that does
/// not exist is recorded as missing, so its later creation invalidates too.
type Fingerprint = Vec<Option<Stamp>>;

fn fingerprint(files: &[PathBuf]) -> Fingerprint {
    files.iter().map(|file| Stamp::of(file)).collect()
}

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    fingerprint: Fingerprint,
    #[serde(default)]
    pricing_revision: u64,
    summaries: Vec<SessionSummary>,
}

#[derive(Default)]
struct State {
    entries: HashMap<PathBuf, Entry>,
    dirty: bool,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    format: u32,
    version: String,
    entries: Vec<(PathBuf, Entry)>,
}

pub struct SummaryCache {
    name: &'static str,
    state: OnceLock<Mutex<State>>,
}

impl SummaryCache {
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            state: OnceLock::new(),
        }
    }

    fn file(&self) -> Option<PathBuf> {
        cache_dir().map(|dir| dir.join(format!("scan-{}.json", self.name)))
    }

    fn lock(&self) -> Option<MutexGuard<'_, State>> {
        self.state
            .get_or_init(|| Mutex::new(self.load()))
            .lock()
            .ok()
    }

    fn load(&self) -> State {
        let entries = self
            .file()
            .and_then(|file| fs::read(file).ok())
            .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
            .filter(|saved| saved.format == FORMAT && saved.version == APP_VERSION)
            .map(|saved| saved.entries.into_iter().collect())
            .unwrap_or_default();
        State {
            entries,
            dirty: false,
        }
    }

    /// Returns the cached summary for the file at `path` if it is unchanged,
    /// otherwise runs `parse` and caches its result (including failures, so a
    /// broken file is not re-read on every scan).
    pub fn get_or_parse(
        &self,
        path: &Path,
        parse: impl FnOnce() -> Option<SessionSummary>,
    ) -> Option<SessionSummary> {
        let files = [path.to_path_buf()];
        self.get_or_scan(path, &files, || parse().into_iter().collect())
            .into_iter()
            .next()
    }

    /// Returns the cached summaries for the source `key` if none of `files`
    /// changed, otherwise runs `scan` and caches its result.
    pub fn get_or_scan(
        &self,
        key: &Path,
        files: &[PathBuf],
        scan: impl FnOnce() -> Vec<SessionSummary>,
    ) -> Vec<SessionSummary> {
        let before = fingerprint(files);
        if before.iter().all(Option::is_none) {
            return scan();
        }
        if let Some(state) = self.lock() {
            if let Some(entry) = state.entries.get(key) {
                if entry.fingerprint == before && entry.pricing_revision == crate::pricing::revision() {
                    return entry.summaries.clone();
                }
            }
        }
        let summaries = scan();
        // Re-check after scanning: if a file changed meanwhile, cache nothing.
        if fingerprint(files) == before {
            if let Some(mut state) = self.lock() {
                state.entries.insert(
                    key.to_path_buf(),
                    Entry {
                        fingerprint: before,
                        pricing_revision: crate::pricing::revision(),
                        summaries: summaries.clone(),
                    },
                );
                state.dirty = true;
            }
        }
        summaries
    }

    /// Drops entries for sources that were not seen in the latest full scan,
    /// then saves the cache if anything changed.
    pub fn finish_scan(&self, seen: &HashSet<PathBuf>) {
        let Some(mut state) = self.lock() else {
            return;
        };
        let before = state.entries.len();
        state.entries.retain(|path, _| seen.contains(path));
        if state.entries.len() != before {
            state.dirty = true;
        }
        if !state.dirty {
            return;
        }
        let Some(file) = self.file() else {
            return;
        };
        let saved = Saved {
            format: FORMAT,
            version: APP_VERSION.to_string(),
            entries: state
                .entries
                .iter()
                .map(|(path, entry)| (path.clone(), entry.clone()))
                .collect(),
        };
        if write_atomic(&file, &saved).is_ok() {
            state.dirty = false;
        }
    }
}

fn write_atomic(file: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temp, file).map_err(|error| error.to_string())
}

/// The library as of the last completed scan, shown at launch while a fresh
/// scan runs in the background.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    /// When the sessions were scanned (RFC 3339).
    pub scanned_at: String,
    pub sessions: Vec<SessionSummary>,
    pub detections: Vec<AgentDetection>,
}

#[derive(Serialize, Deserialize)]
struct Snapshot<T> {
    format: u32,
    version: String,
    saved_at: String,
    value: T,
}

fn save_snapshot<T: Serialize>(name: &str, value: T) {
    if let Some(dir) = cache_dir() {
        let snapshot = Snapshot {
            format: FORMAT,
            version: APP_VERSION.to_string(),
            saved_at: crate::util::iso_now(),
            value,
        };
        let _ = write_atomic(&dir.join(name), &snapshot);
    }
}

fn load_snapshot<T: for<'de> Deserialize<'de>>(name: &str) -> Option<Snapshot<T>> {
    let bytes = fs::read(cache_dir()?.join(name)).ok()?;
    let snapshot: Snapshot<T> = serde_json::from_slice(&bytes).ok()?;
    (snapshot.format == FORMAT && snapshot.version == APP_VERSION).then_some(snapshot)
}

pub fn save_sessions(sessions: &[SessionSummary]) {
    save_snapshot(SESSIONS_FILE, sessions);
}

pub fn save_detections(detections: &[AgentDetection]) {
    save_snapshot(DETECTIONS_FILE, detections);
}

/// The saved library, limited to `agents`. `None` when no sessions were saved
/// yet, or they were saved by another version of SessionPal.
pub fn load_library(agents: &[AgentId]) -> Option<LibrarySnapshot> {
    let sessions = load_snapshot::<Vec<SessionSummary>>(SESSIONS_FILE)?;
    let detections = load_snapshot::<Vec<AgentDetection>>(DETECTIONS_FILE)
        .map(|snapshot| snapshot.value)
        .unwrap_or_default();
    Some(LibrarySnapshot {
        scanned_at: sessions.saved_at,
        sessions: sessions
            .value
            .into_iter()
            .filter(|session| agents.contains(&session.agent))
            .collect(),
        detections,
    })
}

/// An SQLite database and its write-ahead log, which holds recent writes not
/// yet merged into the database. (`-shm` is skipped: readers touch it too.)
pub fn sqlite_files(db: &Path) -> Vec<PathBuf> {
    let mut wal = db.as_os_str().to_os_string();
    wal.push("-wal");
    vec![db.to_path_buf(), PathBuf::from(wal)]
}
