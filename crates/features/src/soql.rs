//! SOQL execution slice: run a query → typed [`QueryResult`] → flat [`TableModel`].

use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sf_core::{SfError, SfInvoker};
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

/// A parsed SOQL query response.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub total_size: u64,
    pub done: bool,
    pub records: Vec<Record>,
}

/// A single SOQL record. Field order mirrors the query (preserved via a custom
/// `Deserialize` that walks the JSON map in source order).
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub sobject_type: String,
    pub fields: Vec<(String, FieldValue)>,
}

/// The value of a single field within a [`Record`].
#[derive(Debug, Clone, PartialEq)]
pub enum FieldValue {
    Null,
    Scalar(serde_json::Value),
    Parent(Box<Record>),
    Children(QueryResult),
}

/// A flat, table-shaped projection of a [`QueryResult`].
#[derive(Debug, Clone, PartialEq)]
pub struct TableModel {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl<'de> Deserialize<'de> for Record {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RecordVisitor;

        impl<'de> Visitor<'de> for RecordVisitor {
            type Value = Record;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a SOQL record object")
            }

            fn visit_map<M>(self, mut map: M) -> Result<Record, M::Error>
            where
                M: MapAccess<'de>,
            {
                let mut sobject_type = String::new();
                let mut fields: Vec<(String, FieldValue)> = Vec::new();

                while let Some((key, value)) = map.next_entry::<String, serde_json::Value>()? {
                    if key == "attributes" {
                        sobject_type = value
                            .get("type")
                            .and_then(|t| t.as_str())
                            .ok_or_else(|| de::Error::custom("record attributes missing `type`"))?
                            .to_string();
                    } else {
                        fields.push((key, classify::<M::Error>(value)?));
                    }
                }

                Ok(Record {
                    sobject_type,
                    fields,
                })
            }
        }

        deserializer.deserialize_map(RecordVisitor)
    }
}

/// Classify a raw JSON value into a [`FieldValue`].
///
// ponytail: a Parent's *nested* field order falls back to serde_json's default
// (sorted) since the value goes through Value; top-level/query order is
// preserved. Upgrade to preserve_order when SP-E needs deep nested order.
fn classify<E>(v: serde_json::Value) -> Result<FieldValue, E>
where
    E: de::Error,
{
    match v {
        serde_json::Value::Null => Ok(FieldValue::Null),
        serde_json::Value::Object(ref map) if map.contains_key("records") => {
            let qr = serde_json::from_value::<QueryResult>(v).map_err(de::Error::custom)?;
            Ok(FieldValue::Children(qr))
        }
        serde_json::Value::Object(ref map) if map.contains_key("attributes") => {
            let rec = serde_json::from_value::<Record>(v).map_err(de::Error::custom)?;
            Ok(FieldValue::Parent(Box::new(rec)))
        }
        other => Ok(FieldValue::Scalar(other)),
    }
}

impl QueryResult {
    /// Parse the `result` object of an `sf data query --json` envelope from its
    /// raw JSON text.
    ///
    /// Takes `&str` rather than `&serde_json::Value` on purpose: deserializing
    /// from a string drives the custom [`Record`] visitor in source order,
    /// whereas `serde_json::Value` is a sorted map (no `preserve_order`) and
    /// would lose the query's top-level field order.
    pub fn from_json(result: &str) -> Result<QueryResult, serde_json::Error> {
        serde_json::from_str(result)
    }

    /// Project records into a flat [`TableModel`].
    ///
    /// Columns are the union of leaf paths across all records in first-seen
    /// order. Parents expand to dotted leaves; subqueries become a single
    /// column rendered as the child `total_size`.
    pub fn to_table(&self) -> TableModel {
        // A field that is a `Parent` in *any* record expands to dotted leaves;
        // when the same field is `Null` in another record it must not also emit
        // a bare column. Collect those parent paths up front.
        let mut parent_paths: Vec<String> = Vec::new();
        for record in &self.records {
            collect_parent_paths(&record.fields, "", &mut parent_paths);
        }

        let mut columns: Vec<String> = Vec::new();
        for record in &self.records {
            collect_columns(&record.fields, "", &parent_paths, &mut columns);
        }

        let rows = self
            .records
            .iter()
            .map(|record| columns.iter().map(|col| render_cell(record, col)).collect())
            .collect();

        TableModel { columns, rows }
    }
}

/// Record every field path that appears as a `Parent` in any record.
fn collect_parent_paths(
    fields: &[(String, FieldValue)],
    prefix: &str,
    parent_paths: &mut Vec<String>,
) {
    for (name, value) in fields {
        if let FieldValue::Parent(child) = value {
            let path = format!("{prefix}{name}");
            if !parent_paths.contains(&path) {
                parent_paths.push(path.clone());
            }
            collect_parent_paths(&child.fields, &format!("{path}."), parent_paths);
        }
    }
}

/// Walk fields in order, accumulating leaf column paths (first-seen wins).
fn collect_columns(
    fields: &[(String, FieldValue)],
    prefix: &str,
    parent_paths: &[String],
    columns: &mut Vec<String>,
) {
    for (name, value) in fields {
        let path = format!("{prefix}{name}");
        match value {
            FieldValue::Parent(child) => {
                collect_columns(&child.fields, &format!("{path}."), parent_paths, columns);
            }
            // A null/scalar whose path is a parent elsewhere is covered by the
            // parent's dotted leaves; skip the bare column.
            _ if parent_paths.contains(&path) => {}
            _ => {
                if !columns.contains(&path) {
                    columns.push(path);
                }
            }
        }
    }
}

/// Render a single cell of `record` for the given (possibly dotted) `column`.
fn render_cell(record: &Record, column: &str) -> String {
    let mut parts = column.split('.');
    let head = parts.next().expect("column path is non-empty");
    let Some((_, value)) = record.fields.iter().find(|(k, _)| k == head) else {
        return String::new();
    };

    match value {
        FieldValue::Null => String::new(),
        FieldValue::Scalar(v) => scalar_text(v),
        FieldValue::Children(qr) => qr.total_size.to_string(),
        FieldValue::Parent(child) => {
            let rest = parts.collect::<Vec<_>>().join(".");
            render_cell(child, &rest)
        }
    }
}

/// Render a scalar JSON value as plain text (strings unquoted).
fn scalar_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Optional flags for a SOQL query run.
#[derive(Debug, Clone, Copy, Default)]
pub struct QueryOptions {
    /// Query Tooling API objects (`--use-tooling-api`).
    pub use_tooling_api: bool,
    /// Include deleted/archived rows — queryAll (`--all-rows`).
    pub all_rows: bool,
}

/// Execute a SOQL query and return the typed [`QueryResult`].
pub async fn run_query(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
    opts: QueryOptions,
) -> Result<QueryResult, SfError> {
    let mut args = vec!["data", "query", "-q", soql];
    if let Some(org) = target_org {
        args.push("--target-org");
        args.push(org);
    }
    if opts.use_tooling_api {
        args.push("--use-tooling-api");
    }
    if opts.all_rows {
        args.push("--all-rows");
    }
    invoker.run_json::<QueryResult>(&args).await
}

/// Execute a SOQL query and project it into a flat [`TableModel`].
pub async fn run_query_table(
    invoker: &SfInvoker,
    soql: &str,
    target_org: Option<&str>,
    opts: QueryOptions,
) -> Result<TableModel, SfError> {
    let result = run_query(invoker, soql, target_org, opts).await?;
    Ok(result.to_table())
}

/// One page of a REST `query`/`queryMore` response.
#[derive(Debug, Clone, Deserialize)]
struct QueryPage {
    #[serde(rename = "totalSize")]
    total_size: u64,
    done: bool,
    records: Vec<Record>,
    #[serde(rename = "nextRecordsUrl", default)]
    next_records_url: Option<String>,
}

/// A single entry of the REST error array (`[{ errorCode, message }]`).
#[derive(Debug, Deserialize)]
struct RestError {
    #[serde(rename = "errorCode", default)]
    error_code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

/// Map a non-2xx REST body into the same [`SfError::Command`] shape the CLI path
/// produces, so the UI renders it identically. The body is `[{errorCode,message}]`.
fn parse_rest_error(status: i32, body: &str) -> SfError {
    if let Some(first) = serde_json::from_str::<Vec<RestError>>(body)
        .ok()
        .and_then(|v| v.into_iter().next())
    {
        return SfError::Command {
            status,
            name: first.error_code.unwrap_or_else(|| "Error".into()),
            message: first.message.unwrap_or_default(),
        };
    }
    SfError::Command {
        status,
        name: "Error".into(),
        message: body.to_string(),
    }
}

/// Drive the `query`/`queryMore` pages: accumulate records, report progress after
/// each page via `on_progress(fetched, total)`, and stop between pages when
/// `cancel` is set (returning the rows gathered so far with `done = false`).
/// `fetch` resolves an absolute URL to a page. Pure of HTTP/IO so it is testable.
async fn paginate<F, Fut>(
    first_url: String,
    base_url: &str,
    fetch: F,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
    cancel: &AtomicBool,
) -> Result<QueryResult, SfError>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<QueryPage, SfError>>,
{
    let mut url = first_url;
    let mut records: Vec<Record> = Vec::new();
    let mut total = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(QueryResult {
                total_size: total,
                done: false,
                records,
            });
        }
        // Race the page fetch against cancellation so an in-flight request is
        // dropped (aborted) the moment the user cancels — not just between pages.
        let page = tokio::select! {
            biased;
            res = fetch(url) => res?,
            _ = poll_cancelled(cancel) => {
                return Ok(QueryResult { total_size: total, done: false, records });
            }
        };
        total = page.total_size;
        records.extend(page.records);
        on_progress(records.len() as u64, total);
        match page.next_records_url {
            Some(next) if !page.done => url = format!("{base_url}{next}"),
            _ => {
                return Ok(QueryResult {
                    total_size: total,
                    done: page.done,
                    records,
                })
            }
        }
    }
}

/// Resolves once `cancel` flips true (polled). Used to race against an in-flight
/// page fetch in [`paginate`] so cancellation interrupts the request itself.
async fn poll_cancelled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

async fn fetch_page(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<QueryPage, SfError> {
    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| SfError::Unexpected(format!("HTTP request failed: {e}")))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| SfError::Unexpected(format!("reading response failed: {e}")))?;
    if !status.is_success() {
        return Err(parse_rest_error(status.as_u16() as i32, &body));
    }
    serde_json::from_str::<QueryPage>(&body).map_err(SfError::Parse)
}

/// Execute a SOQL query against the org's REST API, paginating `query`/`queryMore`
/// ourselves so the caller gets `totalSize` after the first page, incremental
/// progress via `on_progress(fetched, total)`, and mid-flight cancellation
/// (returns partial rows with `done = false`). `auth` carries the token / host /
/// API version (the caller fetches & caches it so this stays off the CLI hot
/// path). Unlike [`run_query`], which lets the CLI fetch everything at once.
pub async fn run_query_rest(
    auth: &sf_core::AuthInfo,
    soql: &str,
    opts: QueryOptions,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
    cancel: &AtomicBool,
) -> Result<QueryResult, SfError> {
    let api = auth.api_version.as_deref().unwrap_or("62.0");
    let resource = if opts.use_tooling_api {
        "tooling/query"
    } else if opts.all_rows {
        "queryAll"
    } else {
        "query"
    };
    let base = auth.instance_url.trim_end_matches('/').to_string();
    let mut first = reqwest::Url::parse(&format!("{base}/services/data/v{api}/{resource}/"))
        .map_err(|e| SfError::Unexpected(format!("bad instance URL: {e}")))?;
    first.query_pairs_mut().append_pair("q", soql);

    let client = reqwest::Client::new();
    let token = auth.access_token.clone();
    paginate(
        first.to_string(),
        &base,
        move |url| {
            let client = client.clone();
            let token = token.clone();
            async move { fetch_page(&client, &url, &token).await }
        },
        on_progress,
        cancel,
    )
    .await
}

/// Context-aware completion for the standalone SOQL editor.
///
/// `objects` is the (cached) sObject-name list for FROM completion; the caller owns that cache so
/// keystroke completion never blocks on a live `sf sobject list` (a multi-second call). Field
/// completion still resolves the FROM object's describe (disk-cached) and falls back to keyword/
/// function candidates when describe fails.
/// Follow `chain` from `root`, fetching each hop's target object schema into a
/// map keyed by object name. Stops at the first hop that cannot be resolved.
async fn resolve_related(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    root: &sf_schema::SObjectSchema,
    chain: &[String],
) -> std::collections::HashMap<String, sf_schema::SObjectSchema> {
    let mut map = std::collections::HashMap::new();
    let mut cur = root.clone();
    for (idx, seg) in chain.iter().enumerate() {
        let Some(field) = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        }) else {
            break;
        };
        let refs = field.reference_to.clone();
        // Final hop unions all targets (polymorphic); intermediate hops take the first.
        if idx + 1 == chain.len() {
            for target in &refs {
                if let Ok(s) = store.get_or_fetch(invoker, api, target).await {
                    map.insert(target.clone(), s);
                }
            }
        } else {
            let Some(target) = refs.first().cloned() else {
                break;
            };
            let Ok(schema) = store.get_or_fetch(invoker, api, &target).await else {
                break;
            };
            map.insert(target.clone(), schema.clone());
            cur = schema;
        }
    }
    map
}

pub async fn complete_fields(
    invoker: &SfInvoker,
    root: impl Into<PathBuf>,
    org_id: &str,
    query: &str,
    cursor: usize,
    objects: &[String],
) -> Vec<soql_lang::Candidate> {
    let object = soql_lang::outline(query).from_object;
    let mut store = sf_schema::SchemaStore::new(root, org_id);
    let Some(object) = object else {
        return soql_lang::complete(query, cursor, &empty_schema(), objects, &|_| None);
    };
    let api = crate::api_version::api_version_for(invoker, org_id).await;
    let root_schema = store
        .get_or_fetch(invoker, &api, &object)
        .await
        .unwrap_or_else(|_| empty_schema());
    let chain = soql_lang::relationship_chain_at(query, cursor);
    let mut map = resolve_related(&mut store, invoker, &api, &root_schema, &chain).await;
    // When the cursor sits in a child subquery, fetch the child sObject too.
    if let Some(rel) = soql_lang::subquery_at(query, cursor).and_then(|s| s.from_rel) {
        map.extend(resolve_children(&mut store, invoker, &api, &root_schema, &[rel]).await);
    }
    soql_lang::complete(query, cursor, &root_schema, objects, &|name| map.get(name))
}

/// Fetch the child sObject schema for each child-relationship name, keyed by
/// child sObject name. Names that don't match a child relationship are skipped.
async fn resolve_children(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    root: &sf_schema::SObjectSchema,
    rels: &[String],
) -> std::collections::HashMap<String, sf_schema::SObjectSchema> {
    let mut map = std::collections::HashMap::new();
    for rel in rels {
        let Some(cr) = root.child_relationships.iter().find(|c| {
            c.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(rel))
        }) else {
            continue;
        };
        if let Ok(s) = store.get_or_fetch(invoker, api, &cr.child_sobject).await {
            map.insert(cr.child_sobject.clone(), s);
        }
    }
    map
}

/// Best-effort object-name list for FROM completion.
pub async fn list_sobject_names(invoker: &SfInvoker, org_id: &str) -> Vec<String> {
    let mut args = vec!["sobject", "list", "--sobject", "all"];
    if org_id != "default" {
        args.push("--target-org");
        args.push(org_id);
    }
    invoker
        .run_json::<Vec<String>>(&args)
        .await
        .unwrap_or_default()
}

fn empty_schema() -> sf_schema::SObjectSchema {
    sf_schema::SObjectSchema {
        name: String::new(),
        label: String::new(),
        label_plural: String::new(),
        key_prefix: None,
        custom: false,
        fields: vec![],
        child_relationships: vec![],
        record_type_infos: vec![],
    }
}

/// One SOQL diagnostic for the editor (byte offsets into the query; severity as a lowercase string).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoqlDiagnostic {
    pub message: String,
    pub start: usize,
    pub end: usize,
    pub severity: String,
}

/// Diagnose ONE SOQL string against its FROM describe (empty when no FROM / describe fails).
async fn soql_query_diagnostics(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    query: &str,
) -> Vec<soql_lang::Diagnostic> {
    let outline = soql_lang::outline(query);
    let Some(object) = outline.from_object else {
        return Vec::new();
    };
    let Ok(root_schema) = store.get_or_fetch(invoker, api, &object).await else {
        return Vec::new();
    };

    // Collect dotted paths (SELECT + WHERE) and fetch their relationship targets.
    let mut paths: Vec<String> = outline
        .select_fields
        .iter()
        .map(|f| f.name.clone())
        .collect();
    paths.extend(
        soql_lang::where_conditions(query)
            .into_iter()
            .map(|c| c.field.name),
    );
    let mut map: std::collections::HashMap<String, sf_schema::SObjectSchema> =
        std::collections::HashMap::new();
    for path in paths {
        let segs: Vec<&str> = path.split('.').collect();
        if segs.len() < 2 {
            continue;
        }
        let chain: Vec<String> = segs[..segs.len() - 1]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let hop = resolve_related(store, invoker, api, &root_schema, &chain).await;
        map.extend(hop);
    }

    // Fetch child sObjects for every child subquery so their fields validate.
    let rels: Vec<String> = soql_lang::subquery_groups(query)
        .into_iter()
        .filter_map(|(_, body)| soql_lang::outline(&body).from_object)
        .collect();
    map.extend(resolve_children(store, invoker, api, &root_schema, &rels).await);

    soql_lang::diagnostics(query, &root_schema, &|name| map.get(name))
}

fn to_dto(d: soql_lang::Diagnostic, offset: usize) -> SoqlDiagnostic {
    SoqlDiagnostic {
        message: d.message,
        start: offset + d.start,
        end: offset + d.end,
        severity: match d.severity {
            soql_lang::Severity::Error => "error",
            soql_lang::Severity::Warning => "warning",
        }
        .to_string(),
    }
}

/// Unknown-field diagnostics for the standalone SOQL editor. Best-effort: empty when there is no FROM
/// object or the describe fails (benign -- never invents errors).
pub async fn diagnose(
    invoker: &SfInvoker,
    root: impl Into<PathBuf>,
    org_id: &str,
    query: &str,
) -> Vec<SoqlDiagnostic> {
    let api = crate::api_version::api_version_for(invoker, org_id).await;
    let mut store = sf_schema::SchemaStore::new(root, org_id);
    let mut diags = soql_query_diagnostics(&mut store, invoker, &api, query).await;
    // Schema-free lint: warn on unbounded (no-LIMIT) queries even offline.
    diags.extend(soql_lang::missing_limit(query));
    diags.into_iter().map(|d| to_dto(d, 0)).collect()
}

/// Unknown-field diagnostics for every inline `[SELECT …]` literal in Apex `src`, with spans in
/// Apex-source coordinates. Best-effort (empty regions / describe failures are skipped).
pub async fn diagnose_apex_soql(
    invoker: &SfInvoker,
    root: impl Into<PathBuf>,
    org_id: &str,
    src: &str,
) -> Vec<SoqlDiagnostic> {
    let api = crate::api_version::api_version_for(invoker, org_id).await;
    let mut store = sf_schema::SchemaStore::new(root, org_id);
    let mut out = Vec::new();
    for (start, end) in apex_lang::soql_regions(src) {
        let inner = &src[start..end];
        for d in soql_query_diagnostics(&mut store, invoker, &api, inner).await {
            out.push(to_dto(d, start));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::RawOutput;
    use std::sync::{Arc, Mutex};

    const FIXTURE: &str = include_str!("../tests/fixtures/query_accounts.json");

    /// Extract the raw `result` JSON text from the envelope, preserving field
    /// order (via `RawValue`) so the custom `Record` visitor sees source order.
    fn fixture_result() -> String {
        #[derive(serde::Deserialize)]
        struct Env<'a> {
            #[serde(borrow)]
            result: &'a serde_json::value::RawValue,
        }
        let env: Env = serde_json::from_str(FIXTURE).unwrap();
        env.result.get().to_string()
    }

    #[test]
    fn parses_preserving_query_field_order() {
        let qr = QueryResult::from_json(&fixture_result()).unwrap();

        assert_eq!(qr.total_size, 2);
        assert!(qr.done);
        assert_eq!(qr.records.len(), 2);

        let r0 = &qr.records[0];
        assert_eq!(r0.sobject_type, "Account");
        let keys: Vec<&str> = r0.fields.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["Id", "Name", "Owner", "Contacts"]);

        let owner = &r0.fields.iter().find(|(k, _)| k == "Owner").unwrap().1;
        match owner {
            FieldValue::Parent(parent) => {
                let name = &parent.fields.iter().find(|(k, _)| k == "Name").unwrap().1;
                assert_eq!(*name, FieldValue::Scalar(serde_json::json!("Alice")));
            }
            other => panic!("expected Parent, got {other:?}"),
        }

        let contacts = &r0.fields.iter().find(|(k, _)| k == "Contacts").unwrap().1;
        match contacts {
            FieldValue::Children(child) => assert_eq!(child.total_size, 1),
            other => panic!("expected Children, got {other:?}"),
        }

        let r1 = &qr.records[1];
        assert_eq!(
            r1.fields.iter().find(|(k, _)| k == "Owner").unwrap().1,
            FieldValue::Null
        );
        assert_eq!(
            r1.fields.iter().find(|(k, _)| k == "Contacts").unwrap().1,
            FieldValue::Null
        );
    }

    #[test]
    fn projects_flat_table() {
        let qr = QueryResult::from_json(&fixture_result()).unwrap();
        let table = qr.to_table();

        assert_eq!(table.columns, ["Id", "Name", "Owner.Name", "Contacts"]);
        assert_eq!(
            table.rows,
            vec![
                vec!["001A", "Acme", "Alice", "1"],
                vec!["001B", "Globex", "", ""],
            ]
        );
    }

    #[tokio::test]
    async fn run_query_passes_args_and_parses() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            *seen2.lock().unwrap() = args.to_vec();
            Ok(RawOutput {
                status: 0,
                stdout: FIXTURE.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let soql = "SELECT Id, Name, Owner.Name, (SELECT LastName FROM Contacts) FROM Account";
        let qr = run_query(&invoker, soql, None, QueryOptions::default())
            .await
            .unwrap();

        let args = seen.lock().unwrap().clone();
        assert_eq!(args, vec!["data", "query", "-q", soql, "--json"]);

        assert_eq!(qr.total_size, 2);
        assert_eq!(qr.records[0].sobject_type, "Account");
    }

    #[tokio::test]
    async fn run_query_table_projects_columns() {
        let runner = MockRunner::ok_json(FIXTURE);
        let invoker = SfInvoker::new(Arc::new(runner));

        let table = run_query_table(
            &invoker,
            "SELECT Id FROM Account",
            None,
            QueryOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(table.columns, ["Id", "Name", "Owner.Name", "Contacts"]);
    }

    #[tokio::test]
    async fn run_query_appends_target_org_when_set() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_query(
            &invoker,
            "SELECT Id FROM Account",
            Some("me@x.com"),
            QueryOptions::default(),
        )
        .await
        .unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(
            args.windows(2).any(|w| w == ["--target-org", "me@x.com"]),
            "got: {args:?}"
        );
    }

    #[tokio::test]
    async fn run_query_appends_use_tooling_api_when_set() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_query(
            &invoker,
            "SELECT Id FROM ApexClass",
            None,
            QueryOptions {
                use_tooling_api: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(
            args.iter().any(|a| a == "--use-tooling-api"),
            "got: {args:?}"
        );
    }

    #[tokio::test]
    async fn run_query_appends_all_rows_when_set() {
        use std::sync::{Arc, Mutex};
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        run_query(
            &invoker,
            "SELECT Id FROM Account",
            None,
            QueryOptions {
                all_rows: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let args = seen.lock().unwrap().clone();
        assert!(args.iter().any(|a| a == "--all-rows"), "got: {args:?}");
    }

    fn rec() -> Record {
        Record {
            sobject_type: "Account".into(),
            fields: vec![],
        }
    }

    #[tokio::test]
    async fn paginate_follows_next_url_and_reports_progress() {
        use std::collections::VecDeque;
        let pages = Mutex::new(VecDeque::from(vec![
            QueryPage {
                total_size: 3,
                done: false,
                records: vec![rec(), rec()],
                next_records_url: Some("/services/data/v62.0/query/01g-next".into()),
            },
            QueryPage {
                total_size: 3,
                done: true,
                records: vec![rec()],
                next_records_url: None,
            },
        ]));
        let progress = Mutex::new(Vec::<(u64, u64)>::new());
        let urls = Mutex::new(Vec::<String>::new());
        let cancel = AtomicBool::new(false);
        let res = paginate(
            "https://x.my.salesforce.com/first".into(),
            "https://x.my.salesforce.com",
            |url| {
                urls.lock().unwrap().push(url);
                let p = pages.lock().unwrap().pop_front().unwrap();
                async move { Ok::<_, SfError>(p) }
            },
            &|fetched, total| progress.lock().unwrap().push((fetched, total)),
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(res.total_size, 3);
        assert!(res.done);
        assert_eq!(res.records.len(), 3);
        // Progress is reported once per page, cumulative.
        assert_eq!(*progress.lock().unwrap(), vec![(2, 3), (3, 3)]);
        // The second fetch follows nextRecordsUrl joined onto the base.
        assert_eq!(
            urls.lock().unwrap()[1],
            "https://x.my.salesforce.com/services/data/v62.0/query/01g-next"
        );
    }

    #[tokio::test]
    async fn paginate_stops_immediately_when_pre_cancelled() {
        let cancel = AtomicBool::new(true);
        let res = paginate(
            "u".into(),
            "b",
            |_| async { panic!("must not fetch when cancelled") },
            &|_, _| {},
            &cancel,
        )
        .await
        .unwrap();
        assert!(!res.done);
        assert!(res.records.is_empty());
    }

    #[tokio::test]
    async fn paginate_returns_partial_when_cancelled_mid_flight() {
        use std::collections::VecDeque;
        let pages = Mutex::new(VecDeque::from(vec![QueryPage {
            total_size: 10,
            done: false,
            records: vec![rec(), rec()],
            next_records_url: Some("/n".into()),
        }]));
        let cancel = AtomicBool::new(false);
        let res = paginate(
            "u".into(),
            "b",
            |_| {
                let p = pages.lock().unwrap().pop_front().unwrap();
                cancel.store(true, Ordering::Relaxed); // cancel after page 1
                async move { Ok::<_, SfError>(p) }
            },
            &|_, _| {},
            &cancel,
        )
        .await
        .unwrap();
        assert!(!res.done);
        assert_eq!(res.records.len(), 2);
    }

    #[test]
    fn parse_rest_error_maps_to_command_with_code_and_message() {
        let body = r#"[{"errorCode":"INVALID_TYPE","message":"\nFROM X\n^\nsObject type 'X' is not supported."}]"#;
        match parse_rest_error(400, body) {
            SfError::Command {
                status,
                name,
                message,
            } => {
                assert_eq!(status, 400);
                assert_eq!(name, "INVALID_TYPE");
                assert!(message.contains("not supported"));
                assert!(message.contains('\n'));
            }
            other => panic!("expected Command, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn complete_fields_returns_select_field_labels() {
        let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"Industry","type":"picklist"}]}}"#;
        let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-panel-test-{}", std::process::id()));
        let q = "SELECT Na FROM Account";
        let cursor = q.find("Na").unwrap() + 2;
        let got = complete_fields(&invoker, &dir, "myorg", q, cursor, &[]).await;
        assert!(got
            .iter()
            .any(|c| c.label == "Name" && c.kind == soql_lang::CandidateKind::Field));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn complete_fields_traverses_relationship() {
        // Account.OwnerId → User; cursor after `Owner.` completes User's fields.
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "User") {
                r#"{"status":0,"result":{"name":"User","fields":[{"name":"Email","type":"string"}]}}"#
            } else {
                r#"{"status":0,"result":{"name":"Account","fields":[{"name":"OwnerId","type":"reference","referenceTo":["User"],"relationshipName":"Owner"}]}}"#
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-rel-complete-{}", std::process::id()));
        let q = "SELECT Owner.Em FROM Account";
        let cursor = "SELECT Owner.Em".len();
        let got = complete_fields(&invoker, &dir, "myorg", q, cursor, &[]).await;
        let labels: Vec<String> = got.into_iter().map(|c| c.label).collect();
        assert!(labels.contains(&"Email".to_string()), "{labels:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn complete_fields_in_child_subquery() {
        // Account has child relationship Contacts → Contact; inside the subquery
        // `(SELECT La|` completes Contact's LastName.
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "Contact") {
                r#"{"status":0,"result":{"name":"Contact","fields":[{"name":"LastName","type":"string"}]}}"#
            } else {
                r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Id","type":"id"}],"childRelationships":[{"childSObject":"Contact","field":"AccountId","relationshipName":"Contacts"}]}}"#
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-subq-complete-{}", std::process::id()));
        let q = "SELECT Id, (SELECT La FROM Contacts) FROM Account";
        let cursor = q.find("La FROM").unwrap() + 2;
        let got = complete_fields(&invoker, &dir, "myorg", q, cursor, &[]).await;
        let labels: Vec<String> = got.into_iter().map(|c| c.label).collect();
        assert!(labels.contains(&"LastName".to_string()), "{labels:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diagnose_flags_unknown_dotted_field() {
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "User") {
                r#"{"status":0,"result":{"name":"User","fields":[{"name":"Email","type":"string"}]}}"#
            } else {
                r#"{"status":0,"result":{"name":"Account","fields":[{"name":"OwnerId","type":"reference","referenceTo":["User"],"relationshipName":"Owner"}]}}"#
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-rel-diag-{}", std::process::id()));
        let diags = diagnose(
            &invoker,
            &dir,
            "myorg",
            "SELECT Owner.Bogus FROM Account LIMIT 1",
        )
        .await;
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("Bogus"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn complete_fields_returns_from_object_candidates() {
        let runner = sf_core::runner::MockRunner::new(move |_p, _args| {
            Ok(sf_core::RawOutput {
                status: 1,
                stdout: r#"{"status":1}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir =
            std::env::temp_dir().join(format!("soql-from-complete-test-{}", std::process::id()));
        let objects = vec!["Account".to_string(), "Contact".to_string()];
        let q = "SELECT Id FROM Acc";
        let got = complete_fields(&invoker, &dir, "from-org", q, q.len(), &objects).await;

        assert!(got
            .iter()
            .any(|c| c.label == "Account" && c.kind == soql_lang::CandidateKind::Object));
        assert!(!got.iter().any(|c| c.label == "Contact"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diagnose_flags_unknown_select_field() {
        let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Id","type":"id"},{"name":"Name","type":"string"}]}}"#;
        let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-diag-test-{}", std::process::id()));
        let diags = diagnose(
            &invoker,
            &dir,
            "myorg",
            "SELECT Id, Bogus FROM Account LIMIT 1",
        )
        .await;
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("Bogus"));
        assert_eq!(diags[0].severity, "error");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diagnose_warns_missing_limit_even_when_describe_fails() {
        // Describe fails (status 1) -> no schema -> only the schema-free LIMIT lint.
        let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
            Ok(sf_core::RawOutput {
                status: 1,
                stdout: r#"{"status":1}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("soql-limit-diag-{}", std::process::id()));
        let diags = diagnose(&invoker, &dir, "myorg", "SELECT Id FROM Account").await;
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert_eq!(diags[0].severity, "warning");
        assert!(diags[0].message.contains("LIMIT"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diagnose_apex_soql_offsets_into_source() {
        let body =
            r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Id","type":"id"}]}}"#;
        let runner = sf_core::runner::MockRunner::new(move |_p, _a| {
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = sf_core::SfInvoker::new(std::sync::Arc::new(runner));
        let dir = std::env::temp_dir().join(format!("apex-soql-diag-{}", std::process::id()));
        let src = "Account a = [SELECT Bogus FROM Account];";
        let diags = diagnose_apex_soql(&invoker, &dir, "myorg", src).await;
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert_eq!(&src[diags[0].start..diags[0].end], "Bogus");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
