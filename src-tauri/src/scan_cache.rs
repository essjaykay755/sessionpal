//! In-memory cache of parsed session summaries, keyed by file path and
//! invalidated when a file's size or modification time changes. Rescans then
//! only re-read transcripts that actually changed.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::SystemTime;

use crate::models::SessionSummary;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Fingerprint {
    len: u64,
    modified: Option<SystemTime>,
}

impl Fingerprint {
    fn of(path: &Path) -> Option<Self> {
        let meta = fs::metadata(path).ok()?;
        Some(Self {
            len: meta.len(),
            modified: meta.modified().ok(),
        })
    }
}

type Entries = HashMap<PathBuf, (Fingerprint, Option<SessionSummary>)>;

pub struct SummaryCache {
    entries: OnceLock<Mutex<Entries>>,
}

impl SummaryCache {
    pub const fn new() -> Self {
        Self {
            entries: OnceLock::new(),
        }
    }

    fn lock(&self) -> Option<MutexGuard<'_, Entries>> {
        self.entries
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .ok()
    }

    /// Returns the cached summary for `path` if the file is unchanged, otherwise
    /// runs `parse` and caches its result (including failures, so a broken file
    /// is not re-read on every scan).
    pub fn get_or_parse(
        &self,
        path: &Path,
        parse: impl FnOnce() -> Option<SessionSummary>,
    ) -> Option<SessionSummary> {
        let Some(fingerprint) = Fingerprint::of(path) else {
            return parse();
        };
        if let Some(entries) = self.lock() {
            if let Some((cached, summary)) = entries.get(path) {
                if *cached == fingerprint {
                    return summary.clone();
                }
            }
        }
        let summary = parse();
        // Re-check after parsing: if the file changed meanwhile, cache nothing.
        if Fingerprint::of(path) == Some(fingerprint) {
            if let Some(mut entries) = self.lock() {
                entries.insert(path.to_path_buf(), (fingerprint, summary.clone()));
            }
        }
        summary
    }

    /// Drops entries for files that were not seen in the latest full scan.
    pub fn retain(&self, seen: &HashSet<PathBuf>) {
        if let Some(mut entries) = self.lock() {
            entries.retain(|path, _| seen.contains(path));
        }
    }
}
