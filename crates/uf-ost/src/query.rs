//! Read-only query layer over an org's `index.db`. Every org-scoped answer is
//! stamped with the org alias + snapshot age so an agent can never silently mix
//! a sandbox's schema into production code. No rmcp here — pure DB + DTOs, so
//! the read behaviour is unit-testable without a running MCP server.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use apex_lang::db;
use apex_lang::snapshot;
use apex_lang::symbols::TypeKind;
use rusqlite::Connection;
use sf_schema::sqlite;

use rmcp::schemars;
use serde::Serialize;

/// Failure modes an MCP tool maps onto an rmcp error.
#[derive(Debug)]
pub enum QueryError {
    /// No `index.db` for the org, or its `meta` row is missing.
    NotIndexed(String),
    /// Index exists but was built by an incompatible schema version.
    StaleIndex(String),
    /// Index exists but the requested object/field/type isn't in it.
    NotFound(String),
    /// Underlying SQLite error.
    Db(rusqlite::Error),
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryError::NotIndexed(org) => write!(
                f,
                "org '{org}' is not indexed — run `ost_reindex` (or `uf-ost index --org {org}`)"
            ),
            QueryError::StaleIndex(org) => write!(
                f,
                "org '{org}' index was built by an older uf-ost — run `ost_reindex {org}` to rebuild it"
            ),
            QueryError::NotFound(what) => write!(f, "{what}"),
            QueryError::Db(e) => write!(f, "index read error: {e}"),
        }
    }
}

impl From<rusqlite::Error> for QueryError {
    fn from(e: rusqlite::Error) -> Self {
        QueryError::Db(e)
    }
}

/// Provenance stamp attached to every org-scoped response.
#[derive(Serialize, Clone, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub org: String,
    pub indexed_at: String,
    pub age: String,
    pub generation: i64,
}

impl Stamp {
    fn from_meta(meta: &db::Meta) -> Self {
        Stamp {
            org: meta.alias.clone(),
            indexed_at: meta.indexed_at.clone(),
            age: human_age(&meta.indexed_at),
            generation: meta.generation,
        }
    }
}

/// An opened read-only snapshot: the connection plus its `meta` row.
pub struct Snapshot {
    conn: Connection,
    pub meta: db::Meta,
}

impl Snapshot {
    /// The org + snapshot-age stamp for this snapshot.
    pub fn stamp(&self) -> Stamp {
        Stamp::from_meta(&self.meta)
    }

    /// Read-only connection to the snapshot's `index.db` (for sibling modules).
    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// Open an org's `index.db` read-only. `NotIndexed` when the file or `meta`
/// row is absent — the reader never creates or writes the database.
pub fn open_org(root: &Path, org: &str) -> Result<Snapshot, QueryError> {
    let path = sqlite::db_path(root, org);
    if !path.exists() {
        return Err(QueryError::NotIndexed(org.to_string()));
    }
    let conn = sqlite::open_readonly(&path)?;
    let meta = db::read_meta(&conn)?.ok_or_else(|| QueryError::NotIndexed(org.to_string()))?;
    // Reject an index built by an older schema before any tool SELECTs a column
    // it may not have — fail loud with "reindex", never crash mid-query.
    if meta.schema_version != db::SCHEMA_VERSION {
        return Err(QueryError::StaleIndex(org.to_string()));
    }
    Ok(Snapshot { conn, meta })
}

/// Compact text table of `object`'s fields — one line each: name, type, and
/// (for lookups) `→` what they reference. This is the one firehose tool, so it
/// returns text rather than `Json<T>` to keep a big sObject from flooding the
/// caller's context. The `custom`/`picklist` bools are intentionally dropped:
/// `custom` shows in the `__c` suffix and a picklist field's type is already
/// `picklist`. `filter` keeps only fields whose name contains the substring
/// (case-insensitive).
pub fn object(snap: &Snapshot, object: &str, filter: Option<&str>) -> Result<String, QueryError> {
    let schema = sqlite::read_object(&snap.conn, object)?
        .ok_or_else(|| QueryError::NotFound(format!("object '{object}' not in index")))?;
    let stamp = Stamp::from_meta(&snap.meta);
    let needle = filter.map(str::to_ascii_lowercase);

    let rows: Vec<(String, String)> = schema
        .fields
        .iter()
        .filter(|f| match needle.as_deref() {
            Some(n) => f.name.to_ascii_lowercase().contains(n),
            None => true,
        })
        .map(|f| {
            let ty = if f.reference_to.is_empty() {
                f.field_type.clone()
            } else {
                format!("{}→{}", f.field_type, f.reference_to.join(","))
            };
            (f.name.clone(), ty)
        })
        .collect();

    let width = rows.iter().map(|(n, _)| n.len()).max().unwrap_or(0);
    let count = match filter {
        Some(_) => format!("fields={} shown={}", schema.fields.len(), rows.len()),
        None => format!("fields={}", schema.fields.len()),
    };
    let mut out = format!(
        "{} ({})  org={}  prefix={}  {}  age={}\n",
        schema.name,
        schema.label,
        stamp.org,
        schema.key_prefix.as_deref().unwrap_or("-"),
        count,
        stamp.age,
    );
    for (name, ty) in rows {
        out.push_str(&format!("{name:<width$}  {ty}\n"));
    }
    Ok(out)
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PickVal {
    pub label: String,
    pub value: String,
    pub default: bool,
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PicklistDto {
    pub stamp: Stamp,
    pub object: String,
    pub field: String,
    pub values: Vec<PickVal>,
}

/// Active picklist values of `object.field`.
pub fn picklist(snap: &Snapshot, object: &str, field: &str) -> Result<PicklistDto, QueryError> {
    let schema = sqlite::read_object(&snap.conn, object)?
        .ok_or_else(|| QueryError::NotFound(format!("object '{object}' not in index")))?;
    let f = schema
        .fields
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case(field))
        .ok_or_else(|| QueryError::NotFound(format!("field '{object}.{field}' not in index")))?;
    Ok(PicklistDto {
        stamp: Stamp::from_meta(&snap.meta),
        object: schema.name.clone(),
        field: f.name.clone(),
        values: f
            .picklist_values
            .iter()
            .filter(|v| v.active)
            .map(|v| PickVal {
                label: v.label.clone(),
                value: v.value.clone(),
                default: v.default_value,
            })
            .collect(),
    })
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MethodDto {
    pub signature: String,
    pub is_static: bool,
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PropDto {
    pub name: String,
    #[serde(rename = "type")]
    pub prop_type: String,
    pub is_static: bool,
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApexDto {
    pub stamp: Stamp,
    pub name: String,
    pub kind: String,
    /// `null` for an org type, else the stdlib namespace.
    pub namespace: Option<String>,
    pub parent_class: Option<String>,
    pub interfaces: Vec<String>,
    pub enum_values: Vec<String>,
    pub methods: Vec<MethodDto>,
    pub properties: Vec<PropDto>,
}

/// Member signatures of an Apex class/interface/enum (org type or stdlib).
pub fn apex(snap: &Snapshot, name: &str) -> Result<ApexDto, QueryError> {
    let (namespace, ty) = snapshot::read_apex_type(&snap.conn, name)?
        .ok_or_else(|| QueryError::NotFound(format!("Apex type '{name}' not in index")))?;
    let kind = match ty.kind {
        TypeKind::Class => "class",
        TypeKind::Interface => "interface",
        TypeKind::Enum => "enum",
    };
    Ok(ApexDto {
        stamp: Stamp::from_meta(&snap.meta),
        name: ty.name,
        kind: kind.to_string(),
        namespace,
        parent_class: ty.parent_class,
        interfaces: ty.interfaces,
        enum_values: ty.enum_values,
        methods: ty
            .methods
            .into_iter()
            .map(|m| MethodDto {
                signature: format!("{} {}({})", m.return_type, m.name, m.params.join(", ")),
                is_static: m.is_static,
            })
            .collect(),
        properties: ty
            .properties
            .into_iter()
            .map(|p| PropDto {
                name: p.name,
                prop_type: p.prop_type,
                is_static: p.is_static,
            })
            .collect(),
    })
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchDto {
    pub stamp: Stamp,
    /// `"Object.Field"` matches from the field FTS index.
    pub fields: Vec<String>,
    /// Apex type-name matches.
    pub apex: Vec<String>,
}

/// FTS5 fuzzy match over field names/labels and Apex type names.
pub fn search(snap: &Snapshot, query: &str, limit: usize) -> Result<SearchDto, QueryError> {
    let expr = fts_expr(query);
    let (fields, apex) = if expr.is_empty() {
        (Vec::new(), Vec::new())
    } else {
        let fields = sqlite::search_fields(&snap.conn, &expr, limit)?
            .into_iter()
            .map(|(obj, field, _label)| format!("{obj}.{field}"))
            .collect();
        let apex = db::search_apex(&snap.conn, &expr, limit)?;
        (fields, apex)
    };
    Ok(SearchDto {
        stamp: Stamp::from_meta(&snap.meta),
        fields,
        apex,
    })
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub org: String,
    pub indexed_at: String,
    pub age: String,
    pub generation: i64,
    pub api_version: String,
    pub namespaces: i64,
    pub classes: i64,
    pub sobjects: i64,
    pub stdlib_error: Option<String>,
    pub reindex_in_progress: bool,
}

/// Freshness, counts, `stdlib_error`, and whether a reindex is running.
pub fn status(snap: &Snapshot, reindex_in_progress: bool) -> StatusDto {
    let m = &snap.meta;
    StatusDto {
        org: m.alias.clone(),
        indexed_at: m.indexed_at.clone(),
        age: human_age(&m.indexed_at),
        generation: m.generation,
        api_version: m.api_version.clone(),
        namespaces: m.namespaces,
        classes: m.classes,
        sobjects: m.sobjects,
        stdlib_error: m.stdlib_error.clone(),
        reindex_in_progress,
    }
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldHit {
    pub org: String,
    pub object: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub custom: bool,
    pub age: String,
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldDrift {
    pub field: String,
    /// Every (org, object) carrying the field. Divergent `type` across orgs =
    /// schema drift.
    pub hits: Vec<FieldHit>,
}

/// Which objects/orgs carry `field`. `org = Some` scopes to one org; `None`
/// scans every indexed org under `root` for cross-org drift detection.
pub fn field_drift(root: &Path, field: &str, org: Option<&str>) -> Result<FieldDrift, QueryError> {
    let orgs: Vec<String> = match org {
        Some(o) => vec![o.to_string()],
        None => list_orgs(root),
    };
    let mut hits = Vec::new();
    for org in &orgs {
        let snap = match open_org(root, org) {
            Ok(s) => s,
            Err(QueryError::NotIndexed(_) | QueryError::StaleIndex(_)) => continue,
            Err(e) => return Err(e),
        };
        let age = human_age(&snap.meta.indexed_at);
        for (object, field_type, custom) in sqlite::find_field(&snap.conn, field)? {
            hits.push(FieldHit {
                org: snap.meta.alias.clone(),
                object,
                field_type,
                custom,
                age: age.clone(),
            });
        }
    }
    Ok(FieldDrift {
        field: field.to_string(),
        hits,
    })
}

/// Aliases of every org with an `index.db` under `root`.
pub fn list_orgs(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let db = entry.path().join("index.db");
        if !db.exists() {
            continue;
        }
        if let Ok(conn) = sqlite::open_readonly(&db) {
            if let Ok(Some(meta)) = db::read_meta(&conn) {
                out.push(meta.alias);
            }
        }
    }
    out.sort();
    out
}

/// Tokenize free-text into an FTS5 prefix-match expression: `Bill City` →
/// `Bill* City*`. Non-alphanumeric chars split tokens, so user input can't be a
/// stray FTS operator. Empty when the query has no usable tokens.
fn fts_expr(query: &str) -> String {
    query
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| !t.is_empty())
        .map(|t| format!("{t}*"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Coarse human age from an RFC3339 `YYYY-MM-DDTHH:MM:SSZ` watermark.
fn human_age(indexed_at: &str) -> String {
    let Some(then) = parse_iso(indexed_at) else {
        return "unknown".to_string();
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let d = now.saturating_sub(then);
    if d < 60 {
        "just now".to_string()
    } else if d < 3_600 {
        format!("{}m ago", d / 60)
    } else if d < 86_400 {
        format!("{}h ago", d / 3_600)
    } else {
        format!("{}d ago", d / 86_400)
    }
}

/// Parse `YYYY-MM-DDTHH:MM:SSZ` to a Unix timestamp. `None` on malformed input.
fn parse_iso(s: &str) -> Option<u64> {
    let (date, time) = s.strip_suffix('Z').unwrap_or(s).split_once('T')?;
    let mut d = date.split('-');
    let y: i64 = d.next()?.parse().ok()?;
    let m: i64 = d.next()?.parse().ok()?;
    let day: i64 = d.next()?.parse().ok()?;
    let mut t = time.split(':');
    let h: u64 = t.next()?.parse().ok()?;
    let mi: u64 = t.next()?.parse().ok()?;
    let sec: u64 = t.next()?.parse().ok()?;
    let days = days_from_civil(y, m, day);
    Some((days as u64) * 86_400 + h * 3_600 + mi * 60 + sec)
}

/// Howard Hinnant's (year, month, day) → days-since-epoch. Inverse of the
/// `civil_from_days` in `features::index`.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::{runner::MockRunner, SfInvoker};
    use std::sync::Arc;

    // Round-trip check for the RFC3339 parse against features' formatter.
    #[test]
    fn iso_parse_matches_known_instants() {
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("2021-01-01T00:00:00Z"), Some(1_609_459_200));
        assert_eq!(parse_iso("garbage"), None);
    }

    #[test]
    fn fts_expr_prefixes_tokens_and_drops_operators() {
        assert_eq!(fts_expr("Bill City"), "Bill* City*");
        assert_eq!(fts_expr("  a-b  "), "a* b*");
        assert_eq!(fts_expr("***"), "");
    }

    // Build a real index.db, then exercise the read layer end to end.
    #[tokio::test]
    async fn reads_object_picklist_apex_search_and_drift() {
        let root = std::env::temp_dir().join(format!("uf-ost-q-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        // Full index one org (Account with a picklist + an Apex class).
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            let ok = |s: &str| {
                Ok(sf_core::RawOutput {
                    status: 0,
                    stdout: s.to_string(),
                    stderr: String::new(),
                })
            };
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("completions") {
                ok(
                    r#"{"publicDeclarations":{"System":{"Math":{"methods":[],"properties":[],"constructors":[]}}}}"#,
                )
            } else if a.contains("ApexClass") {
                ok(
                    r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[{"name":"bar","returnType":"String","parameters":[{"type":"Integer"}]}],"properties":[],"innerClasses":[],"interfaces":[]}}]}}"#,
                )
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else if a.contains("composite") {
                ok(
                    r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","label":"Account","fields":[{"name":"Industry","label":"Industry","type":"picklist","referenceTo":[],"picklistValues":[{"label":"Tech","value":"Tech","active":true,"defaultValue":true},{"label":"Old","value":"Old","active":false,"defaultValue":false}]}],"childRelationships":[]}}]}"#,
                )
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#,
                )
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        features::index::index_org(
            &inv,
            root.clone(),
            "MyOrg",
            &features::index::NamespacePolicy::All,
            &mut |_| {},
        )
        .await
        .unwrap();

        let snap = open_org(&root, "MyOrg").unwrap();

        // Object: compact text, header-stamped, carrying the picklist field.
        let obj = object(&snap, "account", None).unwrap();
        assert!(obj.contains("Account (Account)"), "{obj}");
        assert!(obj.contains("org=MyOrg"), "{obj}");
        assert!(obj.contains("Industry"), "{obj}");
        // Filter narrows and reports the shown count.
        let filtered = object(&snap, "account", Some("indus")).unwrap();
        assert!(filtered.contains("shown=1"), "{filtered}");

        // SOQL validation: clean query OK, typo flagged + suggested, bad object.
        let ok = crate::soql::soql_check(&snap, "SELECT Industry FROM Account").unwrap();
        assert!(ok.contains("OK"), "{ok}");
        let bad = crate::soql::soql_check(&snap, "SELECT Industri FROM Account").unwrap();
        assert!(
            bad.contains("Unknown field 'Industri'") && bad.contains("did you mean 'Industry'"),
            "{bad}"
        );
        let obj = crate::soql::soql_check(&snap, "SELECT Id FROM Bogus").unwrap();
        assert!(obj.contains("Unknown object 'Bogus'"), "{obj}");

        // Picklist keeps active-only.
        let pl = picklist(&snap, "Account", "Industry").unwrap();
        let vals: Vec<_> = pl.values.iter().map(|v| v.value.as_str()).collect();
        assert_eq!(vals, vec!["Tech"], "inactive value dropped");
        assert!(pl.values[0].default);

        // Apex signature.
        let ax = apex(&snap, "Foo").unwrap();
        assert_eq!(ax.kind, "class");
        assert_eq!(ax.methods[0].signature, "String bar(Integer)");

        // Search hits both indexes.
        let s = search(&snap, "Indus", 10).unwrap();
        assert!(s.fields.iter().any(|f| f == "Account.Industry"));
        let sa = search(&snap, "Foo", 10).unwrap();
        assert!(sa.apex.iter().any(|t| t == "Foo"));

        // Drift: single org, field present.
        let drift = field_drift(&root, "Industry", None).unwrap();
        assert_eq!(drift.hits.len(), 1);
        assert_eq!(drift.hits[0].org, "MyOrg");
        assert_eq!(drift.hits[0].object, "Account");

        // NotIndexed for an unknown org.
        assert!(matches!(
            open_org(&root, "Nope"),
            Err(QueryError::NotIndexed(_))
        ));

        // Schema-version guard: a mismatched meta is StaleIndex, not a crash.
        drop(snap);
        let rw = sqlite::open(&sqlite::db_path(&root, "MyOrg")).unwrap();
        rw.execute("UPDATE meta SET schema_version = 9999", []).unwrap();
        drop(rw);
        assert!(matches!(
            open_org(&root, "MyOrg"),
            Err(QueryError::StaleIndex(_))
        ));

        let _ = std::fs::remove_dir_all(&root);
    }
}
