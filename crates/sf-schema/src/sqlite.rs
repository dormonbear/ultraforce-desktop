//! SQLite persistence for `SObjectSchema` — shared `objects`/`fields`/`fields_fts`
//! tables in the org's unified `index.db`. This module also owns the shared
//! `open()` helper that apex-lang's `db` module reuses (both crates write the
//! same file, in separate transactions over their own tables).

use crate::model::{Field, SObjectSchema};
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
          child_relationships TEXT NOT NULL,
          record_type_infos TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fields (
          object_id INTEGER NOT NULL,
          name TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
          custom INTEGER NOT NULL, nillable INTEGER NOT NULL,
          reference_to TEXT NOT NULL,
          relationship_name TEXT,
          picklist TEXT NOT NULL,
          controller_name TEXT, dependent_picklist INTEGER NOT NULL,
          calculated INTEGER NOT NULL, calculated_formula TEXT,
          default_value_formula TEXT, length INTEGER NOT NULL,
          is_unique INTEGER NOT NULL, restricted_picklist INTEGER NOT NULL
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
    let record_type_infos = serde_json::to_string(&s.record_type_infos)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO objects (name, label, label_plural, key_prefix, custom, child_relationships, record_type_infos)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            s.name,
            s.label,
            s.label_plural,
            s.key_prefix,
            s.custom as i64,
            child_relationships,
            record_type_infos,
        ],
    )?;
    let object_id = conn.last_insert_rowid();

    for field in &s.fields {
        let reference_to = serde_json::to_string(&field.reference_to)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let picklist = serde_json::to_string(&field.picklist_values)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "INSERT INTO fields (object_id, name, label, type, custom, nillable, reference_to, relationship_name, picklist,
                                 controller_name, dependent_picklist, calculated, calculated_formula,
                                 default_value_formula, length, is_unique, restricted_picklist)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                field.controller_name,
                field.dependent_picklist as i64,
                field.calculated as i64,
                field.calculated_formula,
                field.default_value_formula,
                field.length,
                field.unique as i64,
                field.restricted_picklist as i64,
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
    // DROP + recreate (not DELETE) so a reindex after a SCHEMA_VERSION bump
    // rebuilds these tables with the current column set — the index is a
    // derived cache, never migrated. DDL here is transactional in SQLite, so a
    // concurrent WAL reader still sees the whole old generation until commit.
    tx.execute_batch(
        "DROP TABLE IF EXISTS fields;
         DROP TABLE IF EXISTS objects;
         DROP TABLE IF EXISTS fields_fts;",
    )?;
    ensure_object_schema(&tx)?;
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
        "SELECT id, name, label, label_plural, key_prefix, custom, child_relationships, record_type_infos
         FROM objects WHERE name = ?1 COLLATE NOCASE",
    )?;
    let row = stmt.query_row(params![name], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, String>(7)?,
        ))
    });
    let (object_id, name, label, label_plural, key_prefix, custom, child_json, rt_json) = match row {
        Ok(v) => v,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };

    Ok(Some(build_object(
        conn,
        object_id,
        name,
        label,
        label_plural,
        key_prefix,
        custom,
        &child_json,
        &rt_json,
    )?))
}

/// Reconstruct an `SObjectSchema` from an objects row + its fields.
#[allow(clippy::too_many_arguments)]
fn build_object(
    conn: &Connection,
    object_id: i64,
    name: String,
    label: String,
    label_plural: String,
    key_prefix: Option<String>,
    custom: i64,
    child_json: &str,
    rt_json: &str,
) -> rusqlite::Result<SObjectSchema> {
    Ok(SObjectSchema {
        name,
        label,
        label_plural,
        key_prefix,
        custom: custom != 0,
        fields: read_fields(conn, object_id)?,
        child_relationships: json_col(child_json)?,
        record_type_infos: json_col(rt_json)?,
    })
}

/// Every object, ordered by insertion (`id`), each with its fields.
pub fn read_all_objects(conn: &Connection) -> rusqlite::Result<Vec<SObjectSchema>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, label, label_plural, key_prefix, custom, child_relationships, record_type_infos
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
            row.get::<_, String>(7)?,
        ))
    })?;

    let mut out = Vec::new();
    for row in rows {
        let (object_id, name, label, label_plural, key_prefix, custom, child_json, rt_json) = row?;
        out.push(build_object(
            conn,
            object_id,
            name,
            label,
            label_plural,
            key_prefix,
            custom,
            &child_json,
            &rt_json,
        )?);
    }
    Ok(out)
}

fn read_fields(conn: &Connection, object_id: i64) -> rusqlite::Result<Vec<Field>> {
    let mut stmt = conn.prepare(
        "SELECT name, label, type, custom, nillable, reference_to, relationship_name, picklist,
                controller_name, dependent_picklist, calculated, calculated_formula,
                default_value_formula, length, is_unique, restricted_picklist
         FROM fields WHERE object_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map(params![object_id], |row| {
        Ok(Field {
            name: row.get(0)?,
            label: row.get(1)?,
            field_type: row.get(2)?,
            custom: row.get::<_, i64>(3)? != 0,
            nillable: row.get::<_, i64>(4)? != 0,
            reference_to: json_col(&row.get::<_, String>(5)?)?,
            relationship_name: row.get(6)?,
            picklist_values: json_col(&row.get::<_, String>(7)?)?,
            controller_name: row.get(8)?,
            dependent_picklist: row.get::<_, i64>(9)? != 0,
            calculated: row.get::<_, i64>(10)? != 0,
            calculated_formula: row.get(11)?,
            default_value_formula: row.get(12)?,
            length: row.get(13)?,
            unique: row.get::<_, i64>(14)? != 0,
            restricted_picklist: row.get::<_, i64>(15)? != 0,
            inline_help_text: None,
        })
    })?;
    rows.collect()
}

/// Deserialize a JSON column, mapping serde errors into rusqlite's error type.
fn json_col<T: serde::de::DeserializeOwned>(s: &str) -> rusqlite::Result<T> {
    serde_json::from_str(s).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
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
    use crate::model::{ChildRelationship, PicklistValue, RecordTypeInfo};
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
                    reference_to: vec!["User".into(), "Group".into()],
                    relationship_name: Some("Owner".into()),
                    ..Default::default()
                },
                Field {
                    name: "Type".into(),
                    label: "Account Type".into(),
                    field_type: "picklist".into(),
                    nillable: true,
                    // Tier-1 detail must round-trip: dependency + valid_for.
                    controller_name: Some("Industry".into()),
                    dependent_picklist: true,
                    restricted_picklist: true,
                    picklist_values: vec![
                        PicklistValue {
                            label: "Customer".into(),
                            value: "Customer".into(),
                            active: true,
                            default_value: true,
                            valid_for: Some("gAAA".into()),
                        },
                        PicklistValue {
                            label: "Partner".into(),
                            value: "Partner".into(),
                            active: true,
                            default_value: false,
                            valid_for: None,
                        },
                    ],
                    ..Default::default()
                },
                Field {
                    name: "Score__c".into(),
                    label: "Score".into(),
                    field_type: "double".into(),
                    calculated: true,
                    calculated_formula: Some("Amount * 2".into()),
                    length: 18,
                    unique: true,
                    ..Default::default()
                },
            ],
            child_relationships: vec![ChildRelationship {
                child_sobject: "Contact".into(),
                field: "AccountId".into(),
                relationship_name: Some("Contacts".into()),
            }],
            record_type_infos: vec![RecordTypeInfo {
                record_type_id: Some("012000000000001".into()),
                name: "Business".into(),
                developer_name: "Business".into(),
                active: true,
                master: false,
                available: true,
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
