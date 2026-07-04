//! SQLite persistence for `SObjectSchema` — shared `objects`/`fields`/`fields_fts`
//! tables in the org's unified `index.db`. This module also owns the shared
//! `open()` helper that apex-lang's `db` module reuses (both crates write the
//! same file, in separate transactions over their own tables).

use crate::model::{ChildRelationship, Field, PicklistValue, SObjectSchema};
use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};

/// Replace path separators so an org alias can't escape the cache root.
pub fn sanitize(org: &str) -> String {
    org.replace(['/', '\\'], "_")
}

/// The org's unified `index.db`: `<root>/<sanitized-alias>/index.db`.
pub fn db_path(root: &Path, org: &str) -> PathBuf {
    root.join(sanitize(org)).join("index.db")
}

/// Open an existing `index.db` read-only (no schema creation, no WAL switch) —
/// the query path for readers that must not contend with a running reindex.
pub fn open_readonly(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
}

/// Open (creating parent dirs as needed) the org's unified `index.db`, enable
/// WAL mode, and ensure sf-schema's tables exist. Shared opener for apex-lang.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    ensure_object_schema(&conn)?;
    Ok(conn)
}

/// Create sf-schema's tables (`objects`, `fields`, `fields_fts`) if absent.
pub fn ensure_object_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS objects (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL, label TEXT NOT NULL, label_plural TEXT NOT NULL,
          key_prefix TEXT, custom INTEGER NOT NULL,
          child_relationships TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fields (
          object_id INTEGER NOT NULL,
          name TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
          custom INTEGER NOT NULL, nillable INTEGER NOT NULL,
          reference_to TEXT NOT NULL,
          relationship_name TEXT,
          picklist TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS fields_fts USING fts5(object_name, field_name, field_label);
        ",
    )
}

/// Delete any existing rows for `s.name` (case-insensitive) then insert object
/// + field rows + one `fields_fts` row per field.
pub fn upsert_object(conn: &Connection, s: &SObjectSchema) -> rusqlite::Result<()> {
    delete_object(conn, &s.name)?;

    let child_relationships = serde_json::to_string(&s.child_relationships)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO objects (name, label, label_plural, key_prefix, custom, child_relationships)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            s.name,
            s.label,
            s.label_plural,
            s.key_prefix,
            s.custom as i64,
            child_relationships,
        ],
    )?;
    let object_id = conn.last_insert_rowid();

    for field in &s.fields {
        let reference_to = serde_json::to_string(&field.reference_to)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let picklist = serde_json::to_string(&field.picklist_values)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "INSERT INTO fields (object_id, name, label, type, custom, nillable, reference_to, relationship_name, picklist)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                object_id,
                field.name,
                field.label,
                field.field_type,
                field.custom as i64,
                field.nillable as i64,
                reference_to,
                field.relationship_name,
                picklist,
            ],
        )?;
        conn.execute(
            "INSERT INTO fields_fts (object_name, field_name, field_label) VALUES (?1, ?2, ?3)",
            params![s.name, field.name, field.label],
        )?;
    }
    Ok(())
}

/// Upsert every schema within a single transaction (batch write).
pub fn write_objects(conn: &mut Connection, objects: &[SObjectSchema]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for schema in objects {
        upsert_object(&tx, schema)?;
    }
    tx.commit()
}

/// Full-generation swap in ONE transaction: wipe every object/field/fts row,
/// then insert all of `objects`. A concurrent WAL reader sees the whole old
/// generation until commit, then the whole new one — never a partial index.
/// This is the single-transaction guarantee a background reindex relies on.
pub fn replace_all_objects(
    conn: &mut Connection,
    objects: &[SObjectSchema],
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch("DELETE FROM fields; DELETE FROM objects; DELETE FROM fields_fts;")?;
    for schema in objects {
        upsert_object(&tx, schema)?;
    }
    tx.commit()
}

/// FTS5 fuzzy match over object/field names + labels. `query` is a raw FTS5
/// MATCH expression (the caller tokenizes user input). Returns
/// `(object_name, field_name, field_label)` rows, newest-inserted last.
pub fn search_fields(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT object_name, field_name, field_label FROM fields_fts
         WHERE fields_fts MATCH ?1 LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit as i64], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect()
}

/// Look up an object by name (case-insensitive), reconstructing its fields in
/// insertion order.
pub fn read_object(conn: &Connection, name: &str) -> rusqlite::Result<Option<SObjectSchema>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, label, label_plural, key_prefix, custom, child_relationships
         FROM objects WHERE name = ?1 COLLATE NOCASE",
    )?;
    let row = stmt.query_row(params![name], |row| {
        let child_relationships_json: String = row.get(6)?;
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            child_relationships_json,
        ))
    });
    let (object_id, name, label, label_plural, key_prefix, custom, child_relationships_json) =
        match row {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e),
        };
    let child_relationships: Vec<ChildRelationship> =
        serde_json::from_str(&child_relationships_json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    let fields = read_fields(conn, object_id)?;

    Ok(Some(SObjectSchema {
        name,
        label,
        label_plural,
        key_prefix,
        custom: custom != 0,
        fields,
        child_relationships,
    }))
}

/// Every object, ordered by insertion (`id`), each with its fields.
pub fn read_all_objects(conn: &Connection) -> rusqlite::Result<Vec<SObjectSchema>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, label, label_plural, key_prefix, custom, child_relationships
         FROM objects ORDER BY id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (object_id, name, label, label_plural, key_prefix, custom, child_relationships_json) =
            row?;
        let child_relationships: Vec<ChildRelationship> =
            serde_json::from_str(&child_relationships_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let fields = read_fields(conn, object_id)?;
        out.push(SObjectSchema {
            name,
            label,
            label_plural,
            key_prefix,
            custom: custom != 0,
            fields,
            child_relationships,
        });
    }
    Ok(out)
}

fn read_fields(conn: &Connection, object_id: i64) -> rusqlite::Result<Vec<Field>> {
    let mut stmt = conn.prepare(
        "SELECT name, label, type, custom, nillable, reference_to, relationship_name, picklist
         FROM fields WHERE object_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map(params![object_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (name, label, field_type, custom, nillable, reference_to_json, relationship_name, picklist_json) =
            row?;
        let reference_to: Vec<String> = serde_json::from_str(&reference_to_json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let picklist_values: Vec<PicklistValue> = serde_json::from_str(&picklist_json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        out.push(Field {
            name,
            label,
            field_type,
            custom: custom != 0,
            nillable: nillable != 0,
            reference_to,
            relationship_name,
            picklist_values,
        });
    }
    Ok(out)
}

/// Delete an object's rows (objects + fields + fields_fts), case-insensitive
/// by name. No-op if the object isn't present.
pub fn delete_object(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    let object_id: Option<i64> = match conn.query_row(
        "SELECT id FROM objects WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |row| row.get(0),
    ) {
        Ok(id) => Some(id),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e),
    };
    if let Some(object_id) = object_id {
        conn.execute("DELETE FROM fields WHERE object_id = ?1", params![object_id])?;
        conn.execute("DELETE FROM objects WHERE id = ?1", params![object_id])?;
    }
    conn.execute(
        "DELETE FROM fields_fts WHERE object_name = ?1 COLLATE NOCASE",
        params![name],
    )?;
    Ok(())
}

/// Every object carrying a field named `field_name` (case-insensitive), with
/// that field's type and custom flag. Powers cross-org drift checks.
pub fn find_field(
    conn: &Connection,
    field_name: &str,
) -> rusqlite::Result<Vec<(String, String, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT o.name, f.type, f.custom FROM fields f
         JOIN objects o ON o.id = f.object_id
         WHERE f.name = ?1 COLLATE NOCASE ORDER BY o.name",
    )?;
    let rows = stmt.query_map(params![field_name], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)? != 0,
        ))
    })?;
    rows.collect()
}

/// Count of objects currently stored.
pub fn count_objects(conn: &Connection) -> rusqlite::Result<usize> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM objects", [], |row| row.get(0))?;
    Ok(count as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sqlite-fidelity-{}-{nanos}/index.db", std::process::id()))
    }

    /// The Phase-1 seam: a rich `SObjectSchema` (picklist + referenceTo +
    /// child relationships) survives write → read byte-for-byte.
    #[test]
    fn upsert_then_read_object_roundtrips_full_struct() {
        let path = temp_db();
        let conn = open(&path).unwrap();
        let schema = SObjectSchema {
            name: "Account".into(),
            label: "Account".into(),
            label_plural: "Accounts".into(),
            key_prefix: Some("001".into()),
            custom: false,
            fields: vec![
                Field {
                    name: "OwnerId".into(),
                    label: "Owner ID".into(),
                    field_type: "reference".into(),
                    custom: false,
                    nillable: false,
                    reference_to: vec!["User".into(), "Group".into()],
                    relationship_name: Some("Owner".into()),
                    picklist_values: vec![],
                },
                Field {
                    name: "Type".into(),
                    label: "Account Type".into(),
                    field_type: "picklist".into(),
                    custom: false,
                    nillable: true,
                    reference_to: vec![],
                    relationship_name: None,
                    picklist_values: vec![
                        PicklistValue {
                            label: "Customer".into(),
                            value: "Customer".into(),
                            active: true,
                            default_value: true,
                        },
                        PicklistValue {
                            label: "Partner".into(),
                            value: "Partner".into(),
                            active: true,
                            default_value: false,
                        },
                    ],
                },
            ],
            child_relationships: vec![ChildRelationship {
                child_sobject: "Contact".into(),
                field: "AccountId".into(),
                relationship_name: Some("Contacts".into()),
            }],
        };

        upsert_object(&conn, &schema).unwrap();
        let got = read_object(&conn, "account").unwrap().expect("present");
        assert_eq!(got, schema, "full SObjectSchema round-trips through SQLite");

        // Upsert replaces (no duplicate rows) and read_all_objects agrees.
        upsert_object(&conn, &schema).unwrap();
        assert_eq!(count_objects(&conn).unwrap(), 1);
        assert_eq!(read_all_objects(&conn).unwrap(), vec![schema]);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
