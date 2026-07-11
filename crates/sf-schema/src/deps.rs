//! Field where-used (`field_deps` / `field_deps_meta`) cache over the org's
//! shared `index.db`. Split out of `sqlite.rs` to stay under the file-size cap;
//! the table DDL still lives in `sqlite::ensure_object_schema` (one schema
//! owner), this module only reads and replaces rows.

use rusqlite::{params, Connection};

/// One component that references a given field (from the Tooling API
/// MetadataComponentDependency), cached in `field_deps`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldDep {
    pub component_type: String,
    pub component_name: String,
    pub component_id: String,
}

/// Replace the cached dependency set for `object.field` in one transaction:
/// clear prior rows, insert `deps`, and upsert the meta row so a zero-length
/// result is still recorded as "fetched at `fetched_at`". Atomic — on any
/// error the transaction rolls back, leaving the old deps + meta untouched.
pub fn replace_field_deps(
    conn: &Connection,
    object: &str,
    field: &str,
    deps: &[FieldDep],
    fetched_at: i64,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM field_deps WHERE object_name = ?1 AND field_name = ?2",
        params![object, field],
    )?;
    for dep in deps {
        tx.execute(
            "INSERT INTO field_deps (object_name, field_name, component_type, component_name, component_id, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                object,
                field,
                dep.component_type,
                dep.component_name,
                dep.component_id,
                fetched_at,
            ],
        )?;
    }
    tx.execute(
        "INSERT INTO field_deps_meta (object_name, field_name, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(object_name, field_name) DO UPDATE SET fetched_at = excluded.fetched_at",
        params![object, field, fetched_at],
    )?;
    tx.commit()
}

/// Read the cached dependencies for `object.field`. `None` if never fetched;
/// `Some((deps, fetched_at))` otherwise — `deps` may be empty for a
/// fetched-and-zero result (distinguished via `field_deps_meta`).
pub fn get_field_deps(
    conn: &Connection,
    object: &str,
    field: &str,
) -> rusqlite::Result<Option<(Vec<FieldDep>, i64)>> {
    let fetched_at: i64 = match conn.query_row(
        "SELECT fetched_at FROM field_deps_meta WHERE object_name = ?1 AND field_name = ?2",
        params![object, field],
        |row| row.get(0),
    ) {
        Ok(ts) => ts,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };

    let mut stmt = conn.prepare(
        "SELECT component_type, component_name, component_id FROM field_deps
         WHERE object_name = ?1 AND field_name = ?2 ORDER BY rowid",
    )?;
    let deps = stmt
        .query_map(params![object, field], |row| {
            Ok(FieldDep {
                component_type: row.get(0)?,
                component_name: row.get(1)?,
                component_id: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some((deps, fetched_at)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::open;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sqlite-deps-{}-{nanos}/index.db", std::process::id()))
    }

    /// `field_deps` cache: roundtrips deps + timestamp, distinguishes
    /// fetched-and-zero from never-fetched.
    #[test]
    fn field_deps_roundtrip() {
        let path = temp_db();
        let conn = open(&path).unwrap();

        let deps = vec![
            FieldDep {
                component_type: "ApexClass".into(),
                component_name: "AccountService".into(),
                component_id: "01p000000000001".into(),
            },
            FieldDep {
                component_type: "Flow".into(),
                component_name: "Account_Flow".into(),
                component_id: "301000000000001".into(),
            },
        ];
        replace_field_deps(&conn, "Account", "Industry", &deps, 1234).unwrap();
        assert_eq!(
            get_field_deps(&conn, "Account", "Industry").unwrap(),
            Some((deps.clone(), 1234))
        );

        // Replacing with an empty slice = fetched-and-zero: Some(empty, ts).
        replace_field_deps(&conn, "Account", "Industry", &[], 5678).unwrap();
        assert_eq!(
            get_field_deps(&conn, "Account", "Industry").unwrap(),
            Some((vec![], 5678))
        );

        // Never fetched = None.
        assert_eq!(get_field_deps(&conn, "Account", "Nope").unwrap(), None);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
