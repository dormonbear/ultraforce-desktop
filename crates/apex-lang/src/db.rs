//! SQLite tables owned by apex-lang: `meta`, `apex_types`, `apex_members`,
//! `raw_cache`, `apex_fts`. Shares the org's unified `index.db` file (and the
//! `sqlite::open` opener) with sf-schema's `objects`/`fields` tables.

use rusqlite::{params, Connection};
use std::path::Path;

/// Create apex-lang's tables if absent.
pub fn ensure_apex_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
          id INTEGER PRIMARY KEY CHECK (id=1),
          schema_version INTEGER NOT NULL, alias TEXT NOT NULL, org_id TEXT NOT NULL,
          api_version TEXT NOT NULL, indexed_at TEXT NOT NULL, generation INTEGER NOT NULL,
          namespaces INTEGER NOT NULL, classes INTEGER NOT NULL, sobjects INTEGER NOT NULL,
          stdlib_error TEXT
        );
        CREATE TABLE IF NOT EXISTS apex_types (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL, kind TEXT NOT NULL,
          namespace TEXT,
          parent_class TEXT, interfaces TEXT NOT NULL, enum_values TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS apex_members (
          type_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL, type_text TEXT NOT NULL,
          params TEXT NOT NULL, is_static INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS raw_cache (
          api_version TEXT NOT NULL, source TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (api_version, source)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS apex_fts USING fts5(type_name);
        ",
    )
}

/// Open the shared `index.db` (via sf-schema's opener, which also ensures its
/// own tables — harmless here) and ensure apex-lang's tables exist.
pub fn open_apex(path: &Path) -> rusqlite::Result<Connection> {
    let conn = sf_schema::sqlite::open(path)?;
    ensure_apex_schema(&conn)?;
    Ok(conn)
}

/// Read a cached raw JSON body for `(api_version, source)`, if present.
pub fn read_raw(conn: &Connection, api_version: &str, source: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT body FROM raw_cache WHERE api_version = ?1 AND source = ?2",
        params![api_version, source],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        e => Err(e),
    })
}

/// Upsert a raw JSON body for `(api_version, source)`.
pub fn write_raw(conn: &Connection, api_version: &str, source: &str, body: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO raw_cache (api_version, source, body) VALUES (?1, ?2, ?3)
         ON CONFLICT(api_version, source) DO UPDATE SET body = excluded.body",
        params![api_version, source, body],
    )?;
    Ok(())
}

/// Delete a cached raw body for `(api_version, source)`.
pub fn delete_raw(conn: &Connection, api_version: &str, source: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM raw_cache WHERE api_version = ?1 AND source = ?2",
        params![api_version, source],
    )?;
    Ok(())
}
