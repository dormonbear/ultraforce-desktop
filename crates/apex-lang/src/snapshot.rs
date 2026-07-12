use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::symbols::{ApexType, Method, Namespace, Ost, Property, TypeKind};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IndexManifest {
    pub org_id: String,
    pub api_version: String,
    pub indexed_at: String,
    pub namespaces: usize,
    pub classes: usize,
    pub sobjects: usize,
    pub stdlib_error: Option<String>,
}

fn db_path(root: &Path, org_id: &str) -> std::path::PathBuf {
    // Sanitize to match OstStore/SchemaStore's org dir, so the schema-cache
    // clear in `reindex_org` also removes the snapshot.
    root.join(crate::store::sanitize(org_id)).join("index.db")
}

fn kind_str(kind: &TypeKind) -> &'static str {
    match kind {
        TypeKind::Class => "class",
        TypeKind::Interface => "interface",
        TypeKind::Enum => "enum",
    }
}

fn kind_from_str(s: &str) -> TypeKind {
    match s {
        "interface" => TypeKind::Interface,
        "enum" => TypeKind::Enum,
        _ => TypeKind::Class,
    }
}

/// Insert one `ApexType` (+ its members + fts row) into `apex_types`/
/// `apex_members`/`apex_fts`. `namespace` is `None` for an org type.
fn insert_type(conn: &Connection, ty: &ApexType, namespace: Option<&str>) -> rusqlite::Result<()> {
    let interfaces = serde_json::to_string(&ty.interfaces)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let enum_values = serde_json::to_string(&ty.enum_values)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    conn.execute(
        "INSERT INTO apex_types (name, kind, namespace, parent_class, interfaces, enum_values)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            ty.name,
            kind_str(&ty.kind),
            namespace,
            ty.parent_class,
            interfaces,
            enum_values,
        ],
    )?;
    let type_id = conn.last_insert_rowid();

    for method in &ty.methods {
        let params_json = serde_json::to_string(&method.params)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "INSERT INTO apex_members (type_id, kind, name, type_text, params, is_static)
             VALUES (?1, 'method', ?2, ?3, ?4, ?5)",
            params![type_id, method.name, method.return_type, params_json, method.is_static as i64],
        )?;
    }
    for property in &ty.properties {
        conn.execute(
            "INSERT INTO apex_members (type_id, kind, name, type_text, params, is_static)
             VALUES (?1, 'property', ?2, ?3, '[]', ?4)",
            params![type_id, property.name, property.prop_type, property.is_static as i64],
        )?;
    }
    conn.execute(
        "INSERT INTO apex_fts (type_name) VALUES (?1)",
        params![ty.name],
    )?;
    Ok(())
}

/// Persist the assembled OST + manifest under `<root>/<org_id>/index.db`.
pub fn save_snapshot(root: &Path, ost: &Ost, manifest: &IndexManifest) -> std::io::Result<()> {
    let path = db_path(root, &manifest.org_id);
    let mut conn = crate::db::open_apex(&path).map_err(std::io::Error::other)?;
    let tx = conn.transaction().map_err(std::io::Error::other)?;

    let generation: i64 = tx
        .query_row("SELECT generation FROM meta WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap_or(0);

    tx.execute_batch("DELETE FROM apex_members; DELETE FROM apex_types; DELETE FROM apex_fts;")
        .map_err(std::io::Error::other)?;

    tx.execute(
        "INSERT INTO meta (id, schema_version, alias, org_id, api_version, indexed_at, generation, namespaces, classes, sobjects, stdlib_error)
         VALUES (1, ?9, ?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           schema_version = excluded.schema_version, alias = excluded.alias, org_id = excluded.org_id,
           api_version = excluded.api_version, indexed_at = excluded.indexed_at, generation = excluded.generation,
           namespaces = excluded.namespaces, classes = excluded.classes, sobjects = excluded.sobjects,
           stdlib_error = excluded.stdlib_error",
        params![
            manifest.org_id,
            manifest.api_version,
            manifest.indexed_at,
            generation + 1,
            manifest.namespaces as i64,
            manifest.classes as i64,
            manifest.sobjects as i64,
            manifest.stdlib_error,
            crate::db::SCHEMA_VERSION,
        ],
    )
    .map_err(std::io::Error::other)?;

    for ty in &ost.org_types {
        insert_type(&tx, ty, None).map_err(std::io::Error::other)?;
    }
    for ns in &ost.namespaces {
        for ty in &ns.types {
            insert_type(&tx, ty, Some(&ns.name)).map_err(std::io::Error::other)?;
        }
    }

    tx.commit().map_err(std::io::Error::other)?;
    Ok(())
}

/// Read only the API version stored in an org's snapshot manifest, without
/// loading the OST. `None` when no snapshot exists. Lets the coordinator keep a
/// good snapshot loadable when live API-version detection fails: a failed
/// detection must not invalidate an otherwise-valid snapshot.
pub fn snapshot_api_version(root: &Path, org_id: &str) -> Option<String> {
    let path = db_path(root, org_id);
    if !path.exists() {
        return None;
    }
    let conn = crate::db::open_apex(&path).ok()?;
    conn.query_row("SELECT api_version FROM meta WHERE id = 1", [], |row| {
        row.get(0)
    })
    .ok()
}

/// Load a persisted snapshot, or `None` when absent / built for another API version.
pub fn load_snapshot(root: &Path, org_id: &str, api_version: &str) -> Option<(Ost, IndexManifest)> {
    let path = db_path(root, org_id);
    if !path.exists() {
        tracing::info!(org = %org_id, "snapshot miss: no index.db file");
        return None;
    }
    let conn = crate::db::open_apex(&path).ok()?;

    let manifest = read_manifest(&conn)?;
    if manifest.api_version != api_version {
        tracing::info!(
            org = %org_id,
            snapshot_api = %manifest.api_version,
            requested_api = %api_version,
            "snapshot rejected: api_version mismatch"
        );
        return None;
    }

    let ost = read_ost(&conn).ok()?;
    Some((ost, manifest))
}

fn read_manifest(conn: &Connection) -> Option<IndexManifest> {
    conn.query_row(
        "SELECT org_id, api_version, indexed_at, namespaces, classes, sobjects, stdlib_error
         FROM meta WHERE id = 1",
        [],
        |row| {
            Ok(IndexManifest {
                org_id: row.get(0)?,
                api_version: row.get(1)?,
                indexed_at: row.get(2)?,
                namespaces: row.get::<_, i64>(3)? as usize,
                classes: row.get::<_, i64>(4)? as usize,
                sobjects: row.get::<_, i64>(5)? as usize,
                stdlib_error: row.get(6)?,
            })
        },
    )
    .ok()
}

struct TypeRow {
    id: i64,
    name: String,
    kind: String,
    namespace: Option<String>,
    parent_class: Option<String>,
    interfaces: String,
    enum_values: String,
}

fn read_ost(conn: &Connection) -> rusqlite::Result<Ost> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, namespace, parent_class, interfaces, enum_values
         FROM apex_types ORDER BY id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TypeRow {
            id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            namespace: row.get(3)?,
            parent_class: row.get(4)?,
            interfaces: row.get(5)?,
            enum_values: row.get(6)?,
        })
    })?;

    let mut org_types: Vec<ApexType> = Vec::new();
    // Namespace order = first-seen order; each namespace's types preserve
    // their apex_types.id (insertion) order.
    let mut namespace_order: Vec<String> = Vec::new();
    let mut namespace_types: std::collections::HashMap<String, Vec<ApexType>> =
        std::collections::HashMap::new();

    for row in rows {
        let row = row?;
        let interfaces: Vec<String> = serde_json::from_str(&row.interfaces)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let enum_values: Vec<String> = serde_json::from_str(&row.enum_values)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let (methods, properties) = read_members(conn, row.id)?;

        let ty = ApexType {
            name: row.name,
            kind: kind_from_str(&row.kind),
            parent_class: row.parent_class,
            interfaces,
            methods,
            properties,
            enum_values,
        };

        match row.namespace {
            None => org_types.push(ty),
            Some(ns) => {
                if !namespace_types.contains_key(&ns) {
                    namespace_order.push(ns.clone());
                }
                namespace_types.entry(ns).or_default().push(ty);
            }
        }
    }

    let namespaces = namespace_order
        .into_iter()
        .map(|name| {
            let types = namespace_types.remove(&name).unwrap_or_default();
            Namespace { name, types }
        })
        .collect();

    Ok(Ost {
        namespaces,
        org_types,
    })
}

/// Read a single Apex type by name (case-insensitive) with its members, plus
/// its namespace (`None` for an org type, else the stdlib namespace). The
/// targeted read behind `ost_apex` — avoids parsing the whole OST per query.
pub fn read_apex_type(
    conn: &Connection,
    name: &str,
) -> rusqlite::Result<Option<(Option<String>, ApexType)>> {
    let row = conn.query_row(
        "SELECT id, name, kind, namespace, parent_class, interfaces, enum_values
         FROM apex_types WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |row| {
            Ok(TypeRow {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                namespace: row.get(3)?,
                parent_class: row.get(4)?,
                interfaces: row.get(5)?,
                enum_values: row.get(6)?,
            })
        },
    );
    let row = match row {
        Ok(r) => r,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e),
    };
    let interfaces: Vec<String> = serde_json::from_str(&row.interfaces)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let enum_values: Vec<String> = serde_json::from_str(&row.enum_values)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let (methods, properties) = read_members(conn, row.id)?;
    let ty = ApexType {
        name: row.name,
        kind: kind_from_str(&row.kind),
        parent_class: row.parent_class,
        interfaces,
        methods,
        properties,
        enum_values,
    };
    Ok(Some((row.namespace, ty)))
}

fn read_members(conn: &Connection, type_id: i64) -> rusqlite::Result<(Vec<Method>, Vec<Property>)> {
    let mut stmt = conn.prepare(
        "SELECT kind, name, type_text, params, is_static FROM apex_members
         WHERE type_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map(params![type_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;

    let mut methods = Vec::new();
    let mut properties = Vec::new();
    for row in rows {
        let (kind, name, type_text, params_json, is_static) = row?;
        let is_static = is_static != 0;
        if kind == "method" {
            let params: Vec<String> = serde_json::from_str(&params_json)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            methods.push(Method {
                name,
                return_type: type_text,
                params,
                is_static,
            });
        } else {
            properties.push(Property {
                name,
                prop_type: type_text,
                is_static,
            });
        }
    }
    Ok((methods, properties))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Ost};

    fn sample() -> (Ost, IndexManifest) {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Foo".into(),
                ..Default::default()
            }],
        };
        let m = IndexManifest {
            org_id: "myorg".into(),
            api_version: "60.0".into(),
            indexed_at: "2026-06-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 1,
            sobjects: 0,
            stdlib_error: None,
        };
        (ost, m)
    }

    #[test]
    fn save_then_load_roundtrips() {
        let root = std::env::temp_dir().join(format!("snap-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        let (got_ost, got_m) = load_snapshot(&root, "myorg", "60.0").unwrap();
        assert_eq!(got_ost, ost);
        assert_eq!(got_m, m);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_api_version_reads_stored_version_without_ost() {
        let root = std::env::temp_dir().join(format!("snap-ver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(snapshot_api_version(&root, "myorg"), None); // absent
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        assert_eq!(snapshot_api_version(&root, "myorg"), Some("60.0".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_returns_none_on_api_mismatch() {
        let root = std::env::temp_dir().join(format!("snap2-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        assert!(load_snapshot(&root, "myorg", "61.0").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_then_load_roundtrips_rich_ost_with_namespaces_and_members() {
        use crate::symbols::{Method, Namespace, Property, TypeKind};

        let root = std::env::temp_dir().join(format!("snap-rich-{}", std::process::id()));
        let ost = Ost {
            namespaces: vec![Namespace {
                name: "System".into(),
                types: vec![ApexType {
                    name: "MyIface".into(),
                    kind: TypeKind::Interface,
                    parent_class: Some("BaseIface".into()),
                    interfaces: vec!["Comparable".into()],
                    methods: vec![Method {
                        name: "doThing".into(),
                        return_type: "String".into(),
                        params: vec!["Integer".into(), "String".into()],
                        is_static: true,
                    }],
                    properties: vec![Property {
                        name: "count".into(),
                        prop_type: "Integer".into(),
                        is_static: false,
                    }],
                    enum_values: vec!["A".into(), "B".into()],
                }],
            }],
            org_types: vec![ApexType {
                name: "MyOrgClass".into(),
                kind: TypeKind::Class,
                ..Default::default()
            }],
        };
        let m = IndexManifest {
            org_id: "richorg".into(),
            api_version: "61.0".into(),
            indexed_at: "2026-07-01T00:00:00Z".into(),
            namespaces: 1,
            classes: 2,
            sobjects: 0,
            stdlib_error: Some("stdlib completions returned no namespaces".into()),
        };
        save_snapshot(&root, &ost, &m).unwrap();
        let (got_ost, got_m) = load_snapshot(&root, "richorg", "61.0").unwrap();
        assert_eq!(got_ost, ost);
        assert_eq!(got_m, m);
        let _ = std::fs::remove_dir_all(&root);
    }
}
