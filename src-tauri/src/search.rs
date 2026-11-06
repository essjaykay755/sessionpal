//! Full-text search over conversation text.
//!
//! What you and the agents wrote is kept in an SQLite FTS5 index in the app's
//! cache folder, next to the scan cache. After every scan the index is brought
//! up to date in the background: only conversations whose summary changed are
//! read again, and conversations that left the library are dropped. Tool
//! output and injected context are not indexed. The index never leaves this
//! device and can be cleared from Settings.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::models::{AgentId, Message, SessionLocator, SessionSummary};

/// Bump when what gets indexed changes, so old indexes are rebuilt.
const FORMAT: &str = "1";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const INDEX_FILE: &str = "search-index.db";
/// How often progress is reported while the index is being built.
const PROGRESS_EVERY: Duration = Duration::from_millis(500);

pub(crate) struct Index {
    connection: Mutex<Connection>,
    path: Option<PathBuf>,
}

static INDEX: OnceLock<Index> = OnceLock::new();
static PENDING: Mutex<Option<Vec<SessionSummary>>> = Mutex::new(None);
static RUNNING: AtomicBool = AtomicBool::new(false);
static DONE: AtomicU64 = AtomicU64::new(0);
static TOTAL: AtomicU64 = AtomicU64::new(0);
static LISTENER: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

/// Registers what to call whenever the index's contents or progress change,
/// so open searches can run again.
pub fn on_change(listener: impl Fn() + Send + Sync + 'static) {
    let _ = LISTENER.set(Box::new(listener));
}

fn changed() {
    if let Some(listener) = LISTENER.get() {
        listener();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    /// The session's ID as listed, so the UI can match it.
    pub id: String,
    pub agent: AgentId,
    pub message_id: String,
    pub role: String,
    /// Text around the best match, with matches wrapped in U+0001 … U+0002.
    pub snippet: String,
    /// Matching messages in this session.
    pub matches: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub building: bool,
    pub done: u64,
    pub total: u64,
    pub indexed_sessions: u64,
    pub size_bytes: u64,
}

/// Opens (or creates) the index in `dir`. Without a call, an in-memory index
/// is used, which keeps tests and the first moments of startup working.
pub fn init(dir: &Path) {
    let path = dir.join(INDEX_FILE);
    let connection = open(&path).or_else(|_| {
        // A damaged index is only a cache: start again.
        let _ = std::fs::remove_file(&path);
        open(&path)
    });
    if let Ok(connection) = connection {
        let _ = INDEX.set(Index {
            connection: Mutex::new(connection),
            path: Some(path),
        });
    }
}

fn index() -> &'static Index {
    INDEX.get_or_init(memory_index)
}

fn open(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    prepare(&connection)?;
    Ok(connection)
}

fn open_memory() -> Connection {
    let connection = Connection::open_in_memory().expect("in-memory SQLite is always available");
    prepare(&connection).expect("the search schema is valid");
    connection
}

fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);")?;
    let stamp = format!("{FORMAT}/{APP_VERSION}");
    let current: Option<String> = connection
        .query_row("SELECT value FROM meta WHERE key = 'format'", [], |row| row.get(0))
        .optional()?;
    if current.as_deref() != Some(stamp.as_str()) {
        // Another version may read conversations differently: rebuild.
        connection.execute_batch("DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS sessions;")?;
    }
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            session_id TEXT NOT NULL,
            agent TEXT NOT NULL,
            fingerprint TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
            text,
            session UNINDEXED,
            message_id UNINDEXED,
            role UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2',
            prefix = '2 3'
        );",
    )?;
    connection.execute(
        "INSERT INTO meta (key, value) VALUES ('format', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [stamp],
    )?;
    Ok(())
}

fn agent_name(agent: AgentId) -> String {
    serde_json::to_value(agent)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn agent_from(name: &str) -> Option<AgentId> {
    serde_json::from_value(serde_json::Value::String(name.to_string())).ok()
}

fn key(session: &SessionSummary) -> String {
    format!("{}\u{1f}{}", agent_name(session.agent), session.id)
}

/// Changes whenever a conversation gains, loses or rewrites messages.
fn fingerprint(session: &SessionSummary) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        session.updated_at, session.message_count, session.size_bytes, session.tokens, session.path
    )
}

/// Text worth searching: what the user and the agent wrote.
fn indexable(role: &str, content: &str) -> bool {
    matches!(role, "user" | "assistant") && !content.trim().is_empty()
}

// ---------------------------------------------------------------------------
// Keeping the index up to date
// ---------------------------------------------------------------------------

/// Queues `sessions` (the whole library) for indexing on a background thread.
/// A newer library replaces one that has not started yet.
pub fn sync_in_background(sessions: Vec<SessionSummary>) {
    *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(sessions);
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        let next = PENDING.lock().unwrap_or_else(|e| e.into_inner()).take();
        match next {
            Some(sessions) => sync(&sessions),
            None => {
                RUNNING.store(false, Ordering::SeqCst);
                changed();
                // A library queued between `take` and `store` still runs.
                let again = PENDING.lock().unwrap_or_else(|e| e.into_inner()).is_some();
                if !again || RUNNING.swap(true, Ordering::SeqCst) {
                    break;
                }
            }
        }
    });
}

/// Brings the index in line with `sessions`. Each conversation is committed
/// on its own, so search works on what is done while the rest is indexed.
pub fn sync(sessions: &[SessionSummary]) {
    sync_with(index(), sessions, &|session| {
        crate::agents::get_session(&SessionLocator {
            id: session.id.clone(),
            agent: session.agent,
            path: session.path.clone(),
        })
        .map(|detail| detail.messages)
    });
}

type Loader<'a> = &'a dyn Fn(&SessionSummary) -> Result<Vec<Message>, String>;

pub(crate) fn memory_index() -> Index {
    Index {
        connection: Mutex::new(open_memory()),
        path: None,
    }
}

pub(crate) fn sync_with(index: &Index, sessions: &[SessionSummary], load: Loader<'_>) {
    let known: HashMap<String, (i64, String)> = {
        let connection = index.connection.lock().unwrap_or_else(|e| e.into_inner());
        let mut statement = match connection.prepare("SELECT key, id, fingerprint FROM sessions") {
            Ok(statement) => statement,
            Err(_) => return,
        };
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, (row.get::<_, i64>(1)?, row.get::<_, String>(2)?)))
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => return,
        }
    };

    let current: HashSet<String> = sessions.iter().map(key).collect();
    let stale: Vec<i64> = known
        .iter()
        .filter(|(key, _)| !current.contains(*key))
        .map(|(_, (id, _))| *id)
        .collect();
    if !stale.is_empty() {
        let mut connection = index.connection.lock().unwrap_or_else(|e| e.into_inner());
        let transaction = connection.transaction();
        if let Ok(transaction) = transaction {
            for id in &stale {
                let _ = transaction.execute("DELETE FROM messages WHERE session = ?1", [id]);
                let _ = transaction.execute("DELETE FROM sessions WHERE id = ?1", [id]);
            }
            let _ = transaction.commit();
        }
    }

    let outdated: Vec<&SessionSummary> = sessions
        .iter()
        .filter(|session| known.get(&key(session)).map(|(_, print)| print.as_str()) != Some(fingerprint(session).as_str()))
        .collect();
    DONE.store(0, Ordering::SeqCst);
    TOTAL.store(outdated.len() as u64, Ordering::SeqCst);
    if !stale.is_empty() || !outdated.is_empty() {
        changed();
    }
    let mut reported = Instant::now();
    for session in outdated {
        index_session(index, session, load);
        DONE.fetch_add(1, Ordering::SeqCst);
        if reported.elapsed() >= PROGRESS_EVERY {
            reported = Instant::now();
            changed();
        }
    }
}

fn index_session(index: &Index, session: &SessionSummary, load: Loader<'_>) {
    // Reading the transcript happens outside the lock, so searches keep working.
    // A conversation that cannot be read now keeps what was indexed before and
    // its old fingerprint, so the next scan tries it again.
    let Ok(messages) = load(session) else {
        return;
    };
    let mut connection = index.connection.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(transaction) = connection.transaction() else {
        return;
    };
    let key = key(session);
    let existing: Option<i64> = transaction
        .query_row("SELECT id FROM sessions WHERE key = ?1", [&key], |row| row.get(0))
        .optional()
        .ok()
        .flatten();
    if let Some(id) = existing {
        let _ = transaction.execute("DELETE FROM messages WHERE session = ?1", [id]);
    }
    let result = (|| -> rusqlite::Result<()> {
        transaction.execute(
            "INSERT INTO sessions (key, session_id, agent, fingerprint) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id,
                 agent = excluded.agent, fingerprint = excluded.fingerprint",
            params![key, session.id, agent_name(session.agent), fingerprint(session)],
        )?;
        let id: i64 = transaction.query_row("SELECT id FROM sessions WHERE key = ?1", [&key], |row| row.get(0))?;
        let mut insert = transaction
            .prepare("INSERT INTO messages (text, session, message_id, role) VALUES (?1, ?2, ?3, ?4)")?;
        for message in messages.iter().filter(|message| indexable(&message.role, &message.content)) {
            if crate::util::is_injected_context(&message.content) {
                continue;
            }
            insert.execute(params![message.content, id, message.id, message.role])?;
        }
        Ok(())
    })();
    if result.is_ok() {
        let _ = transaction.commit();
    }
}

/// Empties the index. The next scan rebuilds it.
pub fn clear() {
    let connection = index().connection.lock().unwrap_or_else(|e| e.into_inner());
    let _ = connection.execute_batch("DELETE FROM messages; DELETE FROM sessions; VACUUM;");
    drop(connection);
    changed();
}

pub fn status() -> IndexStatus {
    let index = index();
    let indexed_sessions = index
        .connection
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as u64;
    let size_bytes = index
        .path
        .as_ref()
        .map(|path| {
            crate::scan_cache::sqlite_files(path)
                .iter()
                .map(|file| crate::util::file_size(file))
                .sum()
        })
        .unwrap_or(0);
    IndexStatus {
        building: RUNNING.load(Ordering::SeqCst),
        done: DONE.load(Ordering::SeqCst),
        total: TOTAL.load(Ordering::SeqCst),
        indexed_sessions,
        size_bytes,
    }
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/// Turns what the user typed into an FTS5 query: every word must appear in
/// the same message, as the start of a word. A single character only matches
/// itself: as a prefix it would match most of the index, slowly.
pub fn fts_query(input: &str) -> Option<String> {
    let words: Vec<String> = input
        .split_whitespace()
        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|word| !word.is_empty())
        .map(|word| {
            let quoted = format!("\"{}\"", word.replace('"', "\"\""));
            if word.chars().count() > 1 { quoted + "*" } else { quoted }
        })
        .collect();
    (!words.is_empty()).then(|| words.join(" AND "))
}

/// Sessions whose messages contain every word of `input`, best match first.
/// Every matching session is returned unless `limit` is given.
pub fn search(input: &str, limit: Option<usize>) -> Result<Vec<ContentHit>, String> {
    search_in(index(), input, limit)
}

pub(crate) fn search_in(index: &Index, input: &str, limit: Option<usize>) -> Result<Vec<ContentHit>, String> {
    let Some(query) = fts_query(input) else {
        return Ok(Vec::new());
    };
    let failed = |error: rusqlite::Error| format!("Search failed: {error}");
    let connection = index.connection.lock().unwrap_or_else(|e| e.into_inner());

    // Every matching message, grouped by session: the best one and a count.
    struct Best {
        row: i64,
        rank: f64,
        matches: u64,
    }
    let mut best: HashMap<i64, Best> = HashMap::new();
    {
        let mut statement = connection
            .prepare("SELECT session, rowid, rank FROM messages WHERE messages MATCH ?1")
            .map_err(failed)?;
        let rows = statement
            .query_map([&query], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, f64>(2)?)))
            .map_err(failed)?;
        for row in rows {
            let (session, row, rank) = row.map_err(failed)?;
            let entry = best.entry(session).or_insert(Best { row, rank, matches: 0 });
            entry.matches += 1;
            if rank < entry.rank {
                entry.row = row;
                entry.rank = rank;
            }
        }
    }
    let mut ranked: Vec<(i64, Best)> = best.into_iter().collect();
    ranked.sort_by(|a, b| a.1.rank.total_cmp(&b.1.rank).then(a.0.cmp(&b.0)));
    if let Some(limit) = limit {
        ranked.truncate(limit);
    }

    let mut session_row = connection
        .prepare("SELECT session_id, agent FROM sessions WHERE id = ?1")
        .map_err(failed)?;
    let mut message_row = connection
        .prepare(
            "SELECT message_id, role, snippet(messages, 0, char(1), char(2), '…', 18)
             FROM messages WHERE messages MATCH ?1 AND rowid = ?2",
        )
        .map_err(failed)?;
    let mut hits = Vec::with_capacity(ranked.len());
    for (session, best) in ranked {
        let Some((id, agent)) = session_row
            .query_row([session], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .optional()
            .map_err(failed)?
        else {
            continue;
        };
        let Some(agent) = agent_from(&agent) else {
            continue;
        };
        let Some((message_id, role, snippet)) = message_row
            .query_row(params![query, best.row], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .optional()
            .map_err(failed)?
        else {
            continue;
        };
        hits.push(ContentHit {
            id,
            agent,
            message_id,
            role,
            snippet: tidy_snippet(&snippet),
            matches: best.matches,
        });
    }
    Ok(hits)
}

/// Snippets are shown on one line.
fn tidy_snippet(snippet: &str) -> String {
    snippet.split_whitespace().collect::<Vec<_>>().join(" ")
}
