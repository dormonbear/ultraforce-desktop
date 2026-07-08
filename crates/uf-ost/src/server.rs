//! The `ultraforce` MCP server: 8 `ost_*` tools over stdio. Query tools read an
//! org's `index.db` read-only; refresh tools drive `features`. Every org-scoped
//! response carries the org + snapshot-age stamp so an agent can't silently mix
//! a sandbox's schema into production code.

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
        let snap = self.open(&a.org)?;
        query::object(&snap, &a.object, a.filter.as_deref()).map_err(to_err)
    }

    #[tool(
        name = "ost_soql",
        description = "Validate a SOQL query offline against the org's indexed schema — unknown fields, bad relationship names, WHERE type mistakes — with did-you-mean suggestions. Catches INVALID_FIELD / No such column before you run it."
    )]
    async fn ost_soql(
        &self,
        Parameters(a): Parameters<SoqlArgs>,
    ) -> Result<String, ErrorData> {
        let snap = self.open(&a.org)?;
        soql::soql_check(&snap, &a.query).map_err(to_err)
    }

    #[tool(
        name = "ost_fields",
        description = "Full detail for specific fields (batch): formula body, picklist dependency map, length/unique/restricted, relationship name. Use after ost_object to expand the fields you care about."
    )]
    async fn ost_fields(
        &self,
        Parameters(a): Parameters<FieldsArgs>,
    ) -> Result<String, ErrorData> {
        let snap = self.open(&a.org)?;
        detail::fields(&snap, &a.object, &a.fields).map_err(to_err)
    }

    #[tool(
        name = "ost_recordtype",
        description = "Record types of an object: developerName, id, active, master."
    )]
    async fn ost_recordtype(
        &self,
        Parameters(a): Parameters<RecordTypeArgs>,
    ) -> Result<String, ErrorData> {
        let snap = self.open(&a.org)?;
        detail::record_types(&snap, &a.object).map_err(to_err)
    }

    #[tool(
        name = "ost_field",
        description = "Which objects/orgs carry a field (+type). Omit org to scan all indexed orgs for cross-org drift."
    )]
    async fn ost_field(
        &self,
        Parameters(a): Parameters<FieldArgs>,
    ) -> Result<Json<query::FieldDrift>, ErrorData> {
        query::field_drift(&self.root, &a.field, a.org.as_deref())
            .map(Json)
            .map_err(to_err)
    }

    #[tool(
        name = "ost_picklist",
        description = "Active picklist values (label, value, default) of an object.field in an org."
    )]
    async fn ost_picklist(
        &self,
        Parameters(a): Parameters<PicklistArgs>,
    ) -> Result<Json<query::PicklistDto>, ErrorData> {
        let snap = self.open(&a.org)?;
        query::picklist(&snap, &a.object, &a.field)
            .map(Json)
            .map_err(to_err)
    }

    #[tool(
        name = "ost_apex",
        description = "Member signatures of an Apex class/interface/enum from the offline index (avoids the ~145s live SymbolTable query)."
    )]
    async fn ost_apex(
        &self,
        Parameters(a): Parameters<ApexArgs>,
    ) -> Result<Json<query::ApexDto>, ErrorData> {
        let snap = self.open(&a.org)?;
        query::apex(&snap, &a.name).map(Json).map_err(to_err)
    }

    #[tool(
        name = "ost_search",
        description = "FTS5 fuzzy match over field and Apex-type names in an org — for when you only know a human-ish term."
    )]
    async fn ost_search(
        &self,
        Parameters(a): Parameters<SearchArgs>,
    ) -> Result<Json<query::SearchDto>, ErrorData> {
        let snap = self.open(&a.org)?;
        query::search(&snap, &a.query, 25).map(Json).map_err(to_err)
    }

    #[tool(
        name = "ost_status",
        description = "Per-org freshness, counts, stdlib_error, and whether a reindex is in progress. Omit org for all."
    )]
    async fn ost_status(
        &self,
        Parameters(a): Parameters<StatusArgs>,
    ) -> Result<Json<StatusListDto>, ErrorData> {
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
    }

    #[tool(
        name = "ost_sync",
        description = "Synchronous watermark delta refresh of one org; returns {added, updated, removed}. Seconds — you wait."
    )]
    async fn ost_sync(
        &self,
        Parameters(a): Parameters<OrgArgs>,
    ) -> Result<Json<SyncDto>, ErrorData> {
        use std::sync::Arc as StdArc;
        // Fail fast if the org was never indexed (sync is a no-op there).
        self.open(&a.org)?;
        let invoker = sf_core::SfInvoker::new(StdArc::new(sf_core::ProcessRunner));
        let (outcome, _) = features::index::sync_org(
            &invoker,
            self.root.clone(),
            &a.org,
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
    }

    #[tool(
        name = "ost_reindex",
        description = "Kick off an async full reindex of an org (global singleton). Returns started|already_running; poll ost_status; use live `sf` meanwhile."
    )]
    async fn ost_reindex(
        &self,
        Parameters(a): Parameters<OrgArgs>,
    ) -> Result<Json<ReindexDto>, ErrorData> {
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
    }

    #[tool(
        name = "soql_query",
        description = "Execute SOQL against the LIVE org. Validated offline first (typos blocked locally with did-you-mean, zero org round-trip); returns clean columns/rows JSON — no --json | jq pipelines. Default cap 200 rows."
    )]
    async fn soql_query(
        &self,
        Parameters(a): Parameters<SoqlQueryArgs>,
    ) -> Result<Json<live::query::SoqlResultDto>, ErrorData> {
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
    }

    #[tool(
        name = "record_get",
        description = "Fetch one record by Id from the LIVE org (all fields). Replaces `sf data get record`."
    )]
    async fn record_get(
        &self,
        Parameters(a): Parameters<RecordGetArgs>,
    ) -> Result<Json<RecordDto>, ErrorData> {
        live::dml::get(&self.live, &a.org, &a.object, &a.id)
            .await
            .map(|record| Json(RecordDto { record }))
    }

    #[tool(
        name = "record_create",
        description = "Create ONE record in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_create(
        &self,
        Parameters(a): Parameters<RecordCreateArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
        live::dml::create(
            &self.live,
            &a.org,
            &a.object,
            &a.fields,
            a.confirm.unwrap_or(false),
        )
        .await
        .map(Json)
    }

    #[tool(
        name = "record_update",
        description = "Update ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_update(
        &self,
        Parameters(a): Parameters<RecordUpdateArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
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
    }

    #[tool(
        name = "record_delete",
        description = "Delete ONE record by Id in the LIVE org. Production orgs refuse without confirm:true (get user approval first)."
    )]
    async fn record_delete(
        &self,
        Parameters(a): Parameters<RecordDeleteArgs>,
    ) -> Result<Json<live::dml::MutationDto>, ErrorData> {
        live::dml::delete(
            &self.live,
            &a.org,
            &a.object,
            &a.id,
            a.confirm.unwrap_or(false),
        )
        .await
        .map(Json)
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
            "Offline Salesforce org index (schema + Apex symbols). Consult before writing \
             SOQL/Apex or verifying a field/object/picklist. Every answer is stamped with \
             the org and snapshot age — check it. On contradiction with reality: ost_sync \
             (cheap), re-query; if unresolved, ost_reindex and use live `sf` meanwhile."
                .to_string(),
        );
        info
    }
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
