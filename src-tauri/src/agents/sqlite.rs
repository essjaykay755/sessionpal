//! Opening and copying other apps' SQLite databases without ever writing to them.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension};

const BUSY_TIMEOUT: Duration = Duration::from_millis(2500);

fn probe(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
}

/// The errors SQLite reports when it cannot create a WAL database's `-shm` file.
fn cannot_open(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(failure.code, ErrorCode::CannotOpen | ErrorCode::ReadOnly)
    )
}

/// Opens a database read-only. A WAL database whose app has quit has no
/// `-shm` file, and a read-only connection cannot create one; in that case the
/// file is opened as immutable, which reads it as-is and creates nothing.
pub fn open_read_only(path: &Path, label: &str) -> Result<Connection, String> {
    let failed = |error: rusqlite::Error| format!("Could not open the {label} database read-only: {error}");
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let connection = Connection::open_with_flags(path, flags).map_err(failed)?;
    let _ = connection.busy_timeout(BUSY_TIMEOUT);
    match probe(&connection) {
        Ok(_) => return Ok(connection),
        Err(error) if !cannot_open(&error) => return Err(failed(error)),
        Err(_) => {}
    }
    drop(connection);

    let uri = format!("file:{}?immutable=1", uri_path(path));
    let connection =
        Connection::open_with_flags(uri, flags | OpenFlags::SQLITE_OPEN_URI).map_err(failed)?;
    probe(&connection).map_err(failed)?;
    Ok(connection)
}

/// Percent-encodes a filesystem path for a `file:` URI.
fn uri_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut encoded = String::with_capacity(text.len() + 8);
    if !text.starts_with('/') {
        // Windows drive paths: file:/C:/...
        encoded.push('/');
    }
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~' | b':') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Copies the named tables (or every ordinary table when `tables` is `None`)
/// from a read-only source into a new database at `destination`. Returns the
/// names of the tables that were copied.
pub fn copy_tables(
    source: &Connection,
    destination: &Path,
    tables: Option<&[&str]>,
    label: &str,
) -> Result<HashSet<String>, String> {
    let failed = |error: rusqlite::Error| format!("Could not snapshot {label}: {error}");
    let names: Vec<String> = match tables {
        Some(tables) => tables.iter().map(|name| name.to_string()).collect(),
        None => {
            let mut statement = source
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type = 'table' \
                     AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .map_err(failed)?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(failed)?;
            rows.collect::<Result<_, _>>().map_err(failed)?
        }
    };

    let mut destination_connection = Connection::open(destination)
        .map_err(|error| format!("Could not prepare the {label} snapshot: {error}"))?;
    let transaction = destination_connection.transaction().map_err(failed)?;
    // One read transaction keeps every table on the same snapshot.
    source.execute_batch("BEGIN").map_err(failed)?;
    let mut copied = HashSet::new();
    let result = (|| {
        for table in &names {
            let create: Option<Option<String>> = source
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .optional()
                .map_err(failed)?;
            // Virtual tables are skipped; their shadow tables hold the data.
            let Some(Some(create)) = create else {
                continue;
            };
            if create.to_ascii_uppercase().starts_with("CREATE VIRTUAL") {
                continue;
            }
            transaction.execute_batch(&create).map_err(failed)?;
            let quoted = table.replace('"', "\"\"");
            let mut select = source
                .prepare(&format!("SELECT * FROM \"{quoted}\""))
                .map_err(failed)?;
            let columns = select.column_count();
            let placeholders = vec!["?"; columns].join(", ");
            let mut insert = transaction
                .prepare(&format!("INSERT INTO \"{quoted}\" VALUES ({placeholders})"))
                .map_err(failed)?;
            let mut rows = select.query([]).map_err(failed)?;
            while let Some(row) = rows.next().map_err(failed)? {
                let values: Vec<SqlValue> = (0..columns)
                    .map(|index| row.get::<_, SqlValue>(index))
                    .collect::<Result<_, _>>()
                    .map_err(failed)?;
                insert
                    .execute(rusqlite::params_from_iter(values.iter()))
                    .map_err(failed)?;
            }
            copied.insert(table.clone());
        }
        Ok::<(), String>(())
    })();
    let _ = source.execute_batch("COMMIT");
    result?;
    transaction.commit().map_err(failed)?;
    Ok(copied)
}
