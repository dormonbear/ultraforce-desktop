//! The `ultraforce` MCP server: 18 tools over stdio — 11 `ost_*` offline
//! (schema + Apex symbol index) + 7 live-org tools (soql_query, record_*,
//! apex_run, rest_request). Offline query tools read an org's `index.db`
//! read-only; refresh tools drive `features`. Every org-scoped response carries
//! the org + snapshot-age stamp so an agent can't silently mix a sandbox's
//! schema into production code. Every tool call is logged to telemetry.

use std::path::PathBuf;

use rmcp::handler::server::tool::ToolRouter;
use rmcp::handler::server::wrapper::{Json, Parameters};
use rmcp::model::{Implementation, ServerCapabilities, ServerInfo};
use rmcp::{schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler};
use serde::{Deserialize, Serialize};

use crate::lock;
use crate::detail;
use crate::live;
use crate::query::{self, QueryError, Stamp};
use crate::soql;

pub struct OstServer {
    root: PathBuf,
    live: live::LiveCtx,
    // Read by the `#[tool_handler]`-generated dispatch; rustc can't see that use.
    #[allow(dead_code)]
    tool_router: ToolRouter<OstServer>,
}

impl OstServer {
    pub fn new(root: PathBuf) -> Self {
        Self {
            live: live::LiveCtx::new(root.clone()),
            root,
            tool_router: Self::tool_router(),
        }
    }

    fn open(&self, org: &str) -> Result<query::Snapshot, ErrorData> {
        query::open_org(&self.root, org).map_err(to_err)
    }

    /// Spawn a detached `uf-ost index` for `org`. Returns `false` when a
    /// reindex is already running (the global lock file). The spawned indexer
    /// acquires that lock itself, so a duplicate spawn is a harmless no-op —
    /// this check just makes the tool's reply accurate.
    fn start_reindex(&self, org: String) -> Result<bool, ErrorData> {
        if lock::is_running(&self.root, &org) {
            return Ok(false);
        }
        let exe =
            std::env::current_exe().map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let root = self.root.clone();
        tokio::spawn(async move {
            let _ = tokio::process::Command::new(exe)
                .arg("index")
                .arg("--org")
                .arg(&org)
                .arg("--root")
                .arg(&root)
                .status()
                .await;
        });
        Ok(true)
    }

    /// Wrap a tool future: measure duration, log outcome to telemetry, pass the
    /// result through untouched. Telemetry never changes a tool's return value
    /// and never fails a tool (logging errors are swallowed in `Telemetry::log`).
    async fn logged<T>(
        &self,
        tool: &'static str,
        org: Option<&str>,
        params: String,
        fut: impl std::future::Future<Output = Result<T, ErrorData>>,
    ) -> Result<T, ErrorData> {
        let start = std::time::Instant::now();
        let res = fut.await;
        self.live.record_telemetry(
            tool,
            org,
            &params,
            if res.is_ok() { "ok" } else { "error" },
            res.as_ref().err().map(|e| e.message.as_ref()),
            start.elapsed().as_millis() as u64,
        );
        res
    }
}

// ---- tool parameter shapes -------------------------------------------------

#[derive(Deserialize, schemars::JsonSchema)]
struct ObjectArgs {
    /// sf org alias.
    org: String,
    /// sObject API name (case-insensitive).
    object: String,
    /// Case-insensitive substring over field names; omit for all fields.
    filter: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct FieldArgs {
    /// Field API name (case-insensitive).
    field: String,
    /// Optional org alias; omit to scan every indexed org for drift.
    org: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SoqlArgs {
    org: String,
    /// A SOQL query to validate offline against the indexed schema.
    query: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct FieldsArgs {
    org: String,
    object: String,
    /// Field API names to expand (batch — pass several at once).
    fields: Vec<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordTypeArgs {
    org: String,
    object: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct PicklistArgs {
    org: String,
    object: String,
    field: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ApexArgs {
    org: String,
    /// Apex class/interface/enum name (org type or stdlib).
    name: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct SearchArgs {
    /// Free text; fuzzy-matched as prefixes over field and Apex-type names.
    query: String,
    org: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct StatusArgs {
    /// Omit for every indexed org.
    org: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct OrgArgs {
    org: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SoqlQueryArgs {
    org: String,
    /// SOQL to execute against the live org (validated offline first).
    query: String,
    /// Query the Tooling API instead of the data API.
    tooling: Option<bool>,
    /// Include deleted/archived rows (queryAll).
    all_rows: Option<bool>,
    /// Max rows returned (default 200).
    limit: Option<usize>,
    /// Skip offline pre-validation (use after ost_sync disagrees with reality).
    skip_validation: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordGetArgs {
    org: String,
    object: String,
    id: String,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordCreateArgs {
    org: String,
    object: String,
    /// {FieldApiName: value} JSON object.
    fields: serde_json::Value,
    /// Required true for production orgs, after the user approved the change.
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordUpdateArgs {
    org: String,
    object: String,
    id: String,
    fields: serde_json::Value,
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RecordDeleteArgs {
    org: String,
    object: String,
    id: String,
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct RestRequestArgs {
    org: String,
    /// GET | POST | PATCH | PUT | DELETE
    method: String,
    /// Absolute API path starting with /services/ (e.g. /services/data/v62.0/limits).
    path: String,
    /// JSON body for POST/PATCH/PUT.
    body: Option<serde_json::Value>,
    /// Required true for writes against production orgs.
    confirm: Option<bool>,
}

#[derive(Deserialize, schemars::JsonSchema)]
struct ApexRunArgs {
    org: String,
    /// Anonymous Apex source to execute.
    code: String,
    /// Required true for production orgs, after the user approved the change.
    confirm: Option<bool>,
}

// ---- refresh-tool output shapes --------------------------------------------

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SyncDto {
    stamp: Stamp,
    added: usize,
    updated: usize,
    removed: usize,
}

/// MCP requires a tool's output schema to be object-rooted, so the per-org
/// list is wrapped rather than returned as a bare array.
#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct StatusListDto {
    orgs: Vec<query::StatusDto>,
}

/// A live record's fields are an arbitrary JSON object; MCP requires an
/// object-rooted output schema, so wrap the bare value.
#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RecordDto {
    record: serde_json::Value,
}

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ReindexDto {
    org: String,
    /// `"started"` or `"already_running"`.
    status: String,
    /// Age of the snapshot being replaced (absent on a never-indexed org).
    age: Option<String>,
}

// ---- tools -----------------------------------------------------------------

#[tool_router]
impl OstServer {
    // The only firehose tool: returns a compact text table (not `Json<T>` like
    // its siblings) so a big sObject can't flood the caller's context.
    #[tool(
        name = "ost_object",
        description = "Fields of an sObject as a compact table (name · type · →referenceTo). Pass filter to narrow to fields whose name contains a substring, e.g. filter=\"email\"."
    )]
    async fn ost_object(
        &self,
        Parameters(a): Parameters<ObjectArgs>,
    ) -> Result<String, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} filter={:?}", a.object, a.filter);
        self.logged("ost_object", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            query::object(&snap, &a.object, a.filter.as_deref()).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_soql",
        description = "Validate a SOQL query offline against the org's indexed schema — unknown fields, bad relationship names, WHERE type mistakes — with did-you-mean suggestions. Catches INVALID_FIELD / No such column before you run it."
    )]
    async fn ost_soql(
        &self,
        Parameters(a): Parameters<SoqlArgs>,
    ) -> Result<String, ErrorData> {
        let org = a.org.clone();
        let params = a.query.chars().take(400).collect::<String>();
        self.logged("ost_soql", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            soql::soql_check(&snap, &a.query).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_fields",
        description = "Full detail for specific fields (batch): formula body, picklist dependency map, length/unique/restricted, relationship name. Use after ost_object to expand the fields you care about."
    )]
    async fn ost_fields(
        &self,
        Parameters(a): Parameters<FieldsArgs>,
    ) -> Result<String, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} fields={:?}", a.object, a.fields);
        self.logged("ost_fields", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            detail::fields(&snap, &a.object, &a.fields).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_recordtype",
        description = "Record types of an object: developerName, id, active, master."
    )]
    async fn ost_recordtype(
        &self,
        Parameters(a): Parameters<RecordTypeArgs>,
    ) -> Result<String, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={}", a.object);
        self.logged("ost_recordtype", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            detail::record_types(&snap, &a.object).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_field",
        description = "Which objects/orgs carry a field (+type). Omit org to scan all indexed orgs for cross-org drift."
    )]
    async fn ost_field(
        &self,
        Parameters(a): Parameters<FieldArgs>,
    ) -> Result<Json<query::FieldDrift>, ErrorData> {
        let org = a.org.clone();
        let params = format!("field={}", a.field);
        self.logged("ost_field", org.as_deref(), params, async move {
            query::field_drift(&self.root, &a.field, a.org.as_deref())
                .map(Json)
                .map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_picklist",
        description = "Active picklist values (label, value, default) of an object.field in an org."
    )]
    async fn ost_picklist(
        &self,
        Parameters(a): Parameters<PicklistArgs>,
    ) -> Result<Json<query::PicklistDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} field={}", a.object, a.field);
        self.logged("ost_picklist", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            query::picklist(&snap, &a.object, &a.field)
                .map(Json)
                .map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_apex",
        description = "Member signatures of an Apex class/interface/enum from the offline index (avoids the ~145s live SymbolTable query)."
    )]
    async fn ost_apex(
        &self,
        Parameters(a): Parameters<ApexArgs>,
    ) -> Result<Json<query::ApexDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("name={}", a.name);
        self.logged("ost_apex", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            query::apex(&snap, &a.name).map(Json).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_search",
        description = "FTS5 fuzzy match over field and Apex-type names in an org — for when you only know a human-ish term."
    )]
    async fn ost_search(
        &self,
        Parameters(a): Parameters<SearchArgs>,
    ) -> Result<Json<query::SearchDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("query={}", a.query);
        self.logged("ost_search", Some(&org), params, async move {
            let snap = self.open(&a.org)?;
            query::search(&snap, &a.query, 25).map(Json).map_err(to_err)
        })
        .await
    }

    #[tool(
        name = "ost_status",
        description = "Per-org freshness, counts, stdlib_error, and whether a reindex is in progress. Omit org for all."
    )]
    async fn ost_status(
        &self,
        Parameters(a): Parameters<StatusArgs>,
    ) -> Result<Json<StatusListDto>, ErrorData> {
        let org = a.org.clone();
        self.logged("ost_status", org.as_deref(), String::new(), async move {
            let single = a.org.clone();
            let orgs = match a.org {
                Some(o) => vec![o],
                None => query::list_orgs(&self.root),
            };
            let mut out = Vec::new();
            for org in orgs {
                match query::open_org(&self.root, &org) {
                    Ok(snap) => out.push(query::status(&snap, lock::is_running(&self.root, &org))),
                    Err(e) => {
                        if single.is_some() {
                            return Err(to_err(e));
                        }
                    }
                }
            }
            Ok(Json(StatusListDto { orgs: out }))
        })
        .await
    }

    #[tool(
        name = "ost_sync",
        description = "Synchronous watermark delta refresh of one org; returns {added, updated, removed}. Seconds — you wait."
    )]
    async fn ost_sync(
        &self,
        Parameters(a): Parameters<OrgArgs>,
    ) -> Result<Json<SyncDto>, ErrorData> {
        let org = a.org.clone();
        self.logged("ost_sync", Some(&org), String::new(), async move {
            use std::sync::Arc as StdArc;
            // Fail fast if the org was never indexed (sync is a no-op there).
            self.open(&a.org)?;
            let invoker = sf_core::SfInvoker::new(StdArc::new(sf_core::ProcessRunner));
            // Fallback-aware: a failed detection reuses the snapshot's stored version.
            let (api, _) =
                features::api_version::resolve_index_api_version(&invoker, &self.root, &a.org).await;
            let (outcome, _) = features::index::sync_org(
                &invoker,
                self.root.clone(),
                &a.org,
                &api,
                &features::index::NamespacePolicy::All,
            )
            .await
            .map_err(|e| ErrorData::internal_error(format!("sync failed: {e}"), None))?;
            let snap = self.open(&a.org)?;
            Ok(Json(SyncDto {
                stamp: snap.stamp(),
                added: outcome.added,
                updated: outcome.updated,
                removed: outcome.removed,
            }))
        })
        .await
    }

    #[tool(
        name = "ost_reindex",
        description = "Kick off an async full reindex of an org (global singleton). Returns started|already_running; poll ost_status; use live `sf` meanwhile."
    )]
    async fn ost_reindex(
        &self,
        Parameters(a): Parameters<OrgArgs>,
    ) -> Result<Json<ReindexDto>, ErrorData> {
        let org = a.org.clone();
        self.logged("ost_reindex", Some(&org), String::new(), async move {
            let started = self.start_reindex(a.org.clone())?;
            // Stamp with the age of the snapshot being replaced (None if never indexed).
            let age = query::open_org(&self.root, &a.org)
                .ok()
                .map(|s| s.stamp().age);
            Ok(Json(ReindexDto {
                org: a.org,
                status: if started {
                    "started"
                } else {
                    "already_running"
                }
                .into(),
                age,
            }))
        })
        .await
    }

    #[tool(
        name = "soql_query",
        description = "Execute SOQL against the LIVE org. Validated offline first (typos blocked locally with did-you-mean, zero org round-trip); returns clean columns/rows JSON — no --json | jq pipelines. Default cap 200 rows."
    )]
    async fn soql_query(
        &self,
        Parameters(a): Parameters<SoqlQueryArgs>,
    ) -> Result<Json<live::query::SoqlResultDto>, ErrorData> {
        let org = a.org.clone();
        let params = a.query.chars().take(400).collect::<String>();
        self.logged("soql_query", Some(&org), params, async move {
            live::query::soql_query(
                &self.root,
                &self.live,
                &a.org,
                &a.query,
                a.tooling.unwrap_or(false),
                a.all_rows.unwrap_or(false),
                a.limit.unwrap_or(200),
                a.skip_validation.unwrap_or(false),
            )
            .await
            .map(Json)
        })
        .await
    }

    #[tool(
        name = "record_get",
        description = "Fetch one record by Id from the LIVE org (all fields). Replaces `sf data get record`."
    )]
    async fn record_get(
        &self,
        Parameters(a): Parameters<RecordGetArgs>,
    ) -> Result<Json<RecordDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} id={}", a.object, a.id);
        self.logged("record_get", Some(&org), params, async move {
            live::dml::get(&self.live, &a.org, &a.object, &a.id)
                .await
                .map(|record| Json(RecordDto { record }))
        })
        .await
    }

    #[tool(
        name = "record_create",
        description = "Create ONE record in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_create(
        &self,
        Parameters(a): Parameters<RecordCreateArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} fields=[{}]", a.object, field_keys(&a.fields));
        self.logged("record_create", Some(&org), params, async move {
            live::dml::create(
                &self.live,
                &a.org,
                &a.object,
                &a.fields,
                a.confirm.unwrap_or(false),
            )
            .await
            .map(Json)
        })
        .await
    }

    #[tool(
        name = "record_update",
        description = "Update ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_update(
        &self,
        Parameters(a): Parameters<RecordUpdateArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!(
            "object={} id={} fields=[{}]",
            a.object,
            a.id,
            field_keys(&a.fields)
        );
        self.logged("record_update", Some(&org), params, async move {
            live::dml::update(
                &self.live,
                &a.org,
                &a.object,
                &a.id,
                &a.fields,
                a.confirm.unwrap_or(false),
            )
            .await
            .map(Json)
        })
        .await
    }

    #[tool(
        name = "record_delete",
        description = "Delete ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_delete(
        &self,
        Parameters(a): Parameters<RecordDeleteArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("object={} id={}", a.object, a.id);
        self.logged("record_delete", Some(&org), params, async move {
            live::dml::delete(
                &self.live,
                &a.org,
                &a.object,
                &a.id,
                a.confirm.unwrap_or(false),
            )
            .await
            .map(Json)
        })
        .await
    }

    #[tool(
        name = "apex_run",
        description = "Execute anonymous Apex in the LIVE org. Returns structured compile/runtime result + USER_DEBUG lines (no raw log dump). 5-min timeout. Production orgs refuse without confirm:true."
    )]
    async fn apex_run(
        &self,
        Parameters(a): Parameters<ApexRunArgs>,
    ) -> Result<Json<live::apex::ApexRunDto>, ErrorData> {
        let org = a.org.clone();
        let params = a.code.chars().take(400).collect::<String>();
        self.logged("apex_run", Some(&org), params, async move {
            live::apex::apex_run(&self.live, &a.org, &a.code, a.confirm.unwrap_or(false))
                .await
                .map(Json)
        })
        .await
    }

    #[tool(
        name = "rest_request",
        description = "Escape hatch: raw Salesforce REST call (path under /services/). Use when no dedicated tool covers the API. Writes to production refuse without confirm:true."
    )]
    async fn rest_request(
        &self,
        Parameters(a): Parameters<RestRequestArgs>,
    ) -> Result<Json<live::rest::RestDto>, ErrorData> {
        let org = a.org.clone();
        let params = format!("method={} path={}", a.method, a.path);
        self.logged("rest_request", Some(&org), params, async move {
            live::rest::rest(
                &self.live,
                &a.org,
                &a.method,
                &a.path,
                a.body.as_ref(),
                a.confirm.unwrap_or(false),
            )
            .await
            .map(Json)
        })
        .await
    }
}

#[tool_handler]
impl ServerHandler for OstServer {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo / Implementation are #[non_exhaustive] — build from Default.
        let mut server_info = Implementation::default();
        server_info.name = "ultraforce".to_string();
        server_info.version = env!("CARGO_PKG_VERSION").to_string();

        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.server_info = server_info;
        info.instructions = Some(
            "Salesforce org toolkit. OFFLINE (ost_*): schema + Apex symbol index — consult before \
             writing SOQL/Apex; answers are stamped with org + snapshot age. LIVE: soql_query \
             (pre-validated), record_get/create/update/delete, apex_run, rest_request — use these \
             instead of `sf data query` / `sf apex run` / raw REST (structured output, no --json \
             pipelines). Mutations on production orgs require confirm:true AFTER user approval. \
             On schema contradiction: ost_sync, re-query; if unresolved, ost_reindex."
                .to_string(),
        );
        info
    }
}

/// Telemetry params summary for record mutations: the field *names* only —
/// never the values, which can be large or sensitive.
fn field_keys(v: &serde_json::Value) -> String {
    v.as_object()
        .map(|m| m.keys().cloned().collect::<Vec<_>>().join(","))
        .unwrap_or_default()
}

/// Map a query failure onto an rmcp error: DB faults are internal, everything
/// else (unknown org/object/field) is a client-side invalid-params error.
fn to_err(e: QueryError) -> ErrorData {
    let msg = e.to_string();
    match e {
        QueryError::Db(_) => ErrorData::internal_error(msg, None),
        _ => ErrorData::invalid_params(msg, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Security pin: telemetry params summaries must carry field NAMES only —
    // never record VALUES, which leak into both the local and remote sinks.
    #[test]
    fn field_keys_excludes_values() {
        let v = serde_json::json!({"Name": "Acme Corp", "AnnualRevenue": 5000000, "Secret__c": "xyz"});
        let s = field_keys(&v);
        // only KEYS appear, no VALUES
        assert!(s.contains("Name") && s.contains("AnnualRevenue") && s.contains("Secret__c"));
        assert!(
            !s.contains("Acme") && !s.contains("5000000") && !s.contains("xyz"),
            "leaked a value: {s}"
        );
        // non-object ⇒ empty, never panics
        assert_eq!(field_keys(&serde_json::json!([1, 2, 3])), "");
    }

    fn row_count(dir: &std::path::Path) -> i64 {
        let conn = rusqlite::Connection::open(dir.join("telemetry.db")).unwrap();
        // No db/table yet ⇒ nothing was ever logged ⇒ 0 rows.
        conn.query_row("SELECT count(*) FROM tool_log", [], |r| r.get(0))
            .unwrap_or(0)
    }

    // Regression pin for the real gate in `OstServer::logged`: drives an actual
    // tool call (`ost_status`, org: None — no live org / indexed DB needed,
    // `query::list_orgs` just returns empty on a fresh root) through a real
    // `OstServer` and asserts local `tool_log` only appears when
    // `telemetry.json` has `localEnabled: true`. Config is loaded once at
    // `OstServer::new`, so each half rebuilds the server after rewriting the file.
    #[tokio::test]
    async fn local_logging_gated_by_config() {
        let dir = std::env::temp_dir().join(format!("uf-gate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        features::telemetry_config::save(
            &dir,
            &features::telemetry_config::TelemetryConfig {
                local_enabled: false,
                remote_enabled: false,
            },
        )
        .unwrap();
        let server = OstServer::new(dir.clone());
        server
            .ost_status(Parameters(StatusArgs { org: None }))
            .await
            .unwrap();
        assert_eq!(row_count(&dir), 0);

        features::telemetry_config::save(
            &dir,
            &features::telemetry_config::TelemetryConfig {
                local_enabled: true,
                remote_enabled: false,
            },
        )
        .unwrap();
        let server = OstServer::new(dir.clone()); // config is loaded once at construction
        server
            .ost_status(Parameters(StatusArgs { org: None }))
            .await
            .unwrap();
        assert_eq!(row_count(&dir), 1);

        std::fs::remove_dir_all(&dir).ok();
    }
}
