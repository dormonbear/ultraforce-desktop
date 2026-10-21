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
    IdentityMismatch(String),
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
            QueryError::IdentityMismatch(org) => write!(f, "org '{org}' index identity mismatch — inspect or clear the conflicting local index, then run ost_reindex"),
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
    conn.execute_batch("BEGIN")?;
    let has_meta: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta')",
        [],
        |row| row.get(0),
    )?;
    if !has_meta {
        return Err(QueryError::NotIndexed(org.to_string()));
    }
    let meta = db::read_meta(&conn)?.ok_or_else(|| QueryError::NotIndexed(org.to_string()))?;
    if meta.alias != org {
        return Err(QueryError::IdentityMismatch(org.to_string()));
    }
    // Reject an index built by an older schema before any tool SELECTs a column
    // it may not have — fail loud with "reindex", never crash mid-query.
    if meta.schema_version != db::SCHEMA_VERSION {
        return Err(QueryError::StaleIndex(org.to_string()));
    }
    conn.prepare("SELECT o.name, f.name, t.name FROM objects o, fields f, apex_types t LIMIT 0")?;
    conn.prepare("SELECT object_name FROM objects_fts LIMIT 0")?;
    Ok(Snapshot { conn, meta })
}

fn missing(snap: &Snapshot, what: String) -> QueryError {
    let stamp = snap.stamp();
    QueryError::NotFound(format!(
        "{what}; org={} age={} indexedAt={} generation={}",
        stamp.org, stamp.age, stamp.indexed_at, stamp.generation
    ))
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
        .ok_or_else(|| missing(snap, format!("object '{object}' not in index")))?;
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
            // Formula fields show their result type tagged; lookups show their
            // targets + relationship name (so the agent can write `Rel.Field`);
            // dependent picklists point at their controller. Bodies stay out —
            // `ost_fields` carries the formula text and dependency map.
            let mut ty = if f.calculated {
                format!("formula:{}", f.field_type)
            } else {
                f.field_type.clone()
            };
            if !f.reference_to.is_empty() {
                ty.push_str(&format!("→{}", f.reference_to.join(",")));
                if let Some(rel) = &f.relationship_name {
                    ty.push_str(&format!(" [{rel}]"));
                }
            }
            if f.dependent_picklist {
                if let Some(c) = &f.controller_name {
                    ty.push_str(&format!(" dep→{c}"));
                }
            }
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
        .ok_or_else(|| missing(snap, format!("object '{object}' not in index")))?;
    let f = schema
        .fields
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case(field))
        .ok_or_else(|| missing(snap, format!("field '{object}.{field}' not in index")))?;
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
    /// Provider returned an object (true) or explicit null (false) for this
    /// source. None means unknown/not a direct source; true is not a guarantee
    /// that every member is present in the provider's table.
    /// 来源返回对象时为 true，显式 null 时为 false；None 表示未知或非直接来源。
    /// true 不保证提供方的表包含全部成员。
    pub symbol_table_available: Option<bool>,
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
        .ok_or_else(|| missing(snap, format!("Apex type '{name}' not in index")))?;
    let kind = match ty.kind {
        TypeKind::Class => "class",
        TypeKind::Interface => "interface",
        TypeKind::Enum => "enum",
    };
    let symbol_table_available = if namespace.is_none() {
        apex_lang::source_status::availability(&snap.conn, &ty.name, snap.meta.classes).ok().flatten()
    } else { None };
    Ok(ApexDto {
        stamp: Stamp::from_meta(&snap.meta),
        name: ty.name,
        kind: kind.to_string(),
        symbol_table_available,
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
    pub objects: Vec<String>,
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
        objects: if expr.is_empty() {
            Vec::new()
        } else {
            sqlite::search_objects(&snap.conn, &expr, limit)?
        },
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
    pub unavailable_classes: Option<i64>,
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
        unavailable_classes: apex_lang::source_status::unavailable_count(&snap.conn, m.classes).ok().flatten(),
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
    pub snapshots: Vec<Stamp>,
    pub skipped: Vec<SkippedOrg>,
}

/// Which objects/orgs carry `field`. `org = Some` scopes to one org; `None`
/// scans every indexed org under `root` for cross-org drift detection.
pub fn field_drift(root: &Path, field: &str, org: Option<&str>) -> Result<FieldDrift, QueryError> {
    let orgs: Vec<String> = match org {
        Some(o) => vec![o.to_string()],
        None => list_orgs(root),
    };
    let mut hits = Vec::new();
    let mut snapshots = Vec::new();
    let mut skipped = Vec::new();
    for alias in &orgs {
        let snap = match open_org(root, alias) {
            Ok(s) => s,
            Err(e @ (QueryError::NotIndexed(_) | QueryError::StaleIndex(_))) if org.is_none() => {
                skipped.push(SkippedOrg {
                    org: alias.clone(),
                    reason: e.to_string(),
                });
                continue;
            }
            Err(e) if org.is_none() => {
                skipped.push(SkippedOrg::from_error(alias, &e));
                continue;
            }
            Err(e) => return Err(e),
        };
        let rows = match sqlite::find_field(&snap.conn, field) {
            Ok(rows) => rows,
            Err(e) if org.is_none() => {
                skipped.push(SkippedOrg::from_error(alias, &e.into()));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        snapshots.push(snap.stamp());
        let age = human_age(&snap.meta.indexed_at);
        for (object, field_type, custom) in rows {
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
        snapshots,
        skipped,
    })
}

/// An indexed org excluded from a cross-org answer. Never include raw DB errors.
#[derive(Serialize, schemars::JsonSchema)]
pub struct SkippedOrg {
    pub org: String,
    pub reason: String,
}

impl SkippedOrg {
    pub fn from_error(org: &str, error: &QueryError) -> Self {
        let reason = match error {
            QueryError::NotIndexed(_)
            | QueryError::StaleIndex(_)
            | QueryError::IdentityMismatch(_) => error.to_string(),
            _ => "index unreadable — run ost_reindex to rebuild it".to_string(),
        };
        Self {
            org: org.to_string(),
            reason,
        }
    }
}

/// Scoped calls preserve their original shape; unscoped calls group answers by org.
#[derive(Serialize, schemars::JsonSchema)]
pub struct SearchResponse {
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub scoped: Option<SearchDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orgs: Option<Vec<SearchDto>>,
    pub skipped: Vec<SkippedOrg>,
}

pub fn search_orgs(
    root: &Path,
    query: &str,
    org: Option<&str>,
    limit: usize,
) -> Result<SearchResponse, QueryError> {
    if let Some(org) = org {
        return Ok(SearchResponse {
            scoped: Some(search(&open_org(root, org)?, query, limit)?),
            orgs: None,
            skipped: vec![],
        });
    }
    let mut response = SearchResponse {
        scoped: None,
        orgs: Some(vec![]),
        skipped: vec![],
    };
    for org in list_orgs(root) {
        match open_org(root, &org) {
            Ok(snap) => match search(&snap, query, limit) {
                Ok(result) => response
                    .orgs
                    .as_mut()
                    .expect("cross-org response")
                    .push(result),
                Err(e) => response.skipped.push(SkippedOrg::from_error(&org, &e)),
            },
            Err(e @ (QueryError::NotIndexed(_) | QueryError::StaleIndex(_))) => {
                response.skipped.push(SkippedOrg {
                    org,
                    reason: e.to_string(),
                })
            }
            Err(e) => response.skipped.push(SkippedOrg::from_error(&org, &e)),
        }
    }
    Ok(response)
}

/// Aliases of every org with an `index.db` under `root`.
pub fn list_orgs(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return out;
    };
    for entry in entries.flatten() {
        let db = entry.path().join("index.db");
        if !entry.path().is_dir() || !db.is_file() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().into_owned();
        // Recover the original alias only after binding it to this physical
        // folder. A foreign meta.alias must never redirect the next open.
        let alias = sqlite::open_readonly(&db)
            .ok()
            .and_then(|conn| db::read_meta(&conn).ok().flatten())
            .map(|meta| meta.alias)
            .filter(|alias| sqlite::sanitize(alias) == folder);
        out.push(alias.unwrap_or(folder));
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
        .map(|t| format!("\"{t}\"*"))
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
#[path = "query_tests.rs"]
mod tests;
