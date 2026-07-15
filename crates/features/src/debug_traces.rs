//! Manage debug traces across entities: list and batch-save Tooling
//! `TraceFlag` + `DebugLevel` records for any User / ApexClass / ApexTrigger.
//!
//! Separate from [`crate::debug_config`] (the running-user quick-set). Uses the
//! same `SfInvoker` Tooling pattern: `sf data query -t` for reads and
//! `sf data create/update/delete record -t` per record for writes.

use std::collections::HashMap;

use serde::Deserialize;
use sf_core::{SfError, SfInvoker};

use crate::debug_config::{CategoryLevels, LogLevel};

fn with_org<'a>(mut args: Vec<&'a str>, org: Option<&'a str>) -> Vec<&'a str> {
    if let Some(o) = org {
        args.push("--target-org");
        args.push(o);
    }
    args
}

// ---------------------------------------------------------------- domain types

/// What a TraceFlag is tracing, by Salesforce Id key-prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityKind {
    User,
    ApexClass,
    ApexTrigger,
    Unknown,
}

impl EntityKind {
    /// 005=User, 01p=ApexClass, 01q=ApexTrigger.
    pub fn from_id(id: &str) -> EntityKind {
        match id.get(0..3) {
            Some("005") => EntityKind::User,
            Some("01p") => EntityKind::ApexClass,
            Some("01q") => EntityKind::ApexTrigger,
            _ => EntityKind::Unknown,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            EntityKind::User => "User",
            EntityKind::ApexClass => "ApexClass",
            EntityKind::ApexTrigger => "ApexTrigger",
            EntityKind::Unknown => "Unknown",
        }
    }
    /// Default LogType for a traced entity of this kind.
    pub fn default_log_type(self) -> &'static str {
        match self {
            EntityKind::User => "USER_DEBUG",
            EntityKind::ApexClass | EntityKind::ApexTrigger => "CLASS_TRACING",
            EntityKind::Unknown => "USER_DEBUG",
        }
    }
}

/// One existing trace flag, with traced-entity and debug-level names joined in.
#[derive(Debug, Clone)]
pub struct TraceFlagInfo {
    pub id: String,
    pub log_type: String,
    pub traced_entity_id: String,
    pub traced_entity_name: String,
    pub traced_entity_kind: EntityKind,
    pub debug_level_id: String,
    pub debug_level_name: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
    pub creator_name: String,
}

/// One DebugLevel record (named verbosity profile).
#[derive(Debug, Clone)]
pub struct DebugLevelInfo {
    pub id: String,
    pub developer_name: String,
    pub levels: CategoryLevels,
}

/// A traceable entity (user / class / trigger) for the picker.
#[derive(Debug, Clone)]
pub struct EntityOption {
    pub id: String,
    pub name: String,
    pub kind: EntityKind,
    /// Extra searchable terms not shown in `name` (e.g. a user's Email, which
    /// often differs from their Username).
    pub keywords: Vec<String>,
}

/// Everything the dialog needs on open.
#[derive(Debug, Clone)]
pub struct LoggingConfig {
    pub trace_flags: Vec<TraceFlagInfo>,
    pub debug_levels: Vec<DebugLevelInfo>,
    pub entities: Vec<EntityOption>,
}

// ------------------------------------------------------------------ save diff

/// A locally-added DebugLevel. `local_key` lets added trace flags reference it
/// before it has a real Salesforce Id.
#[derive(Debug, Clone)]
pub struct DebugLevelDraft {
    pub local_key: String,
    pub developer_name: String,
    pub levels: CategoryLevels,
}

/// A locally-added TraceFlag. `debug_level_ref` is either a real DebugLevel Id
/// or the `local_key` of a `DebugLevelDraft` in the same diff.
#[derive(Debug, Clone)]
pub struct TraceFlagDraft {
    pub log_type: String,
    pub traced_entity_id: String,
    pub debug_level_ref: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
}

/// A modified DebugLevel (id + new levels; the name is not changed on update).
#[derive(Debug, Clone)]
pub struct DebugLevelMod {
    pub id: String,
    pub levels: CategoryLevels,
}

/// A modified TraceFlag (id + the editable fields).
#[derive(Debug, Clone)]
pub struct TraceFlagMod {
    pub id: String,
    pub debug_level_id: String,
    pub start_date: Option<String>,
    pub expiration_date: Option<String>,
}

/// The batch of changes to commit on Save.
#[derive(Debug, Clone, Default)]
pub struct LoggingDiff {
    pub debug_levels_added: Vec<DebugLevelDraft>,
    pub debug_levels_modified: Vec<DebugLevelMod>,
    pub debug_levels_removed: Vec<String>,
    pub trace_flags_added: Vec<TraceFlagDraft>,
    pub trace_flags_modified: Vec<TraceFlagMod>,
    pub trace_flags_removed: Vec<String>,
}

/// Per-record outcome — failures are reported, never silently dropped.
#[derive(Debug, Clone)]
pub struct RecordResult {
    pub sobject: String,
    pub op: String,
    pub id: Option<String>,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SaveOutcome {
    pub results: Vec<RecordResult>,
}

// --------------------------------------------------------------- deserialize

#[derive(Deserialize)]
struct Records<T> {
    records: Vec<T>,
}

#[derive(Deserialize, Default)]
struct LevelFields {
    #[serde(rename = "ApexCode", default)]
    apex_code: Option<String>,
    #[serde(rename = "ApexProfiling", default)]
    apex_profiling: Option<String>,
    #[serde(rename = "Callout", default)]
    callout: Option<String>,
    #[serde(rename = "DataAccess", default)]
    data_access: Option<String>,
    #[serde(rename = "Database", default)]
    database: Option<String>,
    #[serde(rename = "Nba", default)]
    nba: Option<String>,
    #[serde(rename = "System", default)]
    system: Option<String>,
    #[serde(rename = "Validation", default)]
    validation: Option<String>,
    #[serde(rename = "Visualforce", default)]
    visualforce: Option<String>,
    #[serde(rename = "Wave", default)]
    wave: Option<String>,
    #[serde(rename = "Workflow", default)]
    workflow: Option<String>,
}

fn lvl(o: &Option<String>) -> LogLevel {
    o.as_deref()
        .map(LogLevel::from_sf)
        .unwrap_or(LogLevel::None)
}

fn levels_from(f: &LevelFields) -> CategoryLevels {
    CategoryLevels {
        apex_code: lvl(&f.apex_code),
        apex_profiling: lvl(&f.apex_profiling),
        callout: lvl(&f.callout),
        data_access: lvl(&f.data_access),
        database: lvl(&f.database),
        nba: lvl(&f.nba),
        system: lvl(&f.system),
        validation: lvl(&f.validation),
        visualforce: lvl(&f.visualforce),
        wave: lvl(&f.wave),
        workflow: lvl(&f.workflow),
    }
}

#[derive(Deserialize)]
struct RawDebugLevel {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "DeveloperName")]
    developer_name: String,
    #[serde(flatten)]
    fields: LevelFields,
}

#[derive(Deserialize)]
struct NameRel {
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawTraceFlag {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "LogType")]
    log_type: Option<String>,
    #[serde(rename = "StartDate")]
    start_date: Option<String>,
    #[serde(rename = "ExpirationDate")]
    expiration_date: Option<String>,
    #[serde(rename = "TracedEntityId")]
    traced_entity_id: String,
    #[serde(rename = "DebugLevelId")]
    debug_level_id: String,
    #[serde(rename = "CreatedBy", default)]
    created_by: Option<NameRel>,
}

#[derive(Deserialize)]
struct RawUser {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "Username")]
    username: Option<String>,
    #[serde(rename = "Email")]
    email: Option<String>,
}

#[derive(Deserialize)]
struct RawNamed {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Deserialize)]
struct WriteResult {
    #[serde(default)]
    id: String,
}

// ------------------------------------------------------------------- queries

async fn query_t<T: serde::de::DeserializeOwned>(
    invoker: &SfInvoker,
    soql: &str,
    tooling: bool,
    org: Option<&str>,
) -> Result<Vec<T>, SfError> {
    let mut args = vec!["data", "query", "-q", soql];
    if tooling {
        args.push("-t");
    }
    let r: Records<T> = invoker.run_json(&with_org(args, org)).await?;
    Ok(r.records)
}

/// Load all trace flags, debug levels, and traceable entities for the dialog.
pub async fn load_logging_config(
    invoker: &SfInvoker,
    org: Option<&str>,
) -> Result<LoggingConfig, SfError> {
    let raw_levels: Vec<RawDebugLevel> = query_t(
        invoker,
        "SELECT Id, DeveloperName, ApexCode, ApexProfiling, Callout, DataAccess, Database, \
         Nba, System, Validation, Visualforce, Wave, Workflow FROM DebugLevel",
        true,
        org,
    )
    .await?;

    let raw_flags: Vec<RawTraceFlag> = query_t(
        invoker,
        "SELECT Id, LogType, StartDate, ExpirationDate, TracedEntityId, DebugLevelId, \
         CreatedBy.Name FROM TraceFlag",
        true,
        org,
    )
    .await?;

    let users: Vec<RawUser> = query_t(
        invoker,
        // No LIMIT: a cap silently hides users past the alphabetical cutoff in
        // large orgs, which reads as "user doesn't exist" in the picker.
        "SELECT Id, Name, Username, Email FROM User WHERE IsActive = true ORDER BY Name",
        false,
        org,
    )
    .await?;
    let classes: Vec<RawNamed> = query_t(
        invoker,
        "SELECT Id, Name FROM ApexClass ORDER BY Name",
        true,
        org,
    )
    .await?;
    let triggers: Vec<RawNamed> = query_t(
        invoker,
        "SELECT Id, Name FROM ApexTrigger ORDER BY Name",
        true,
        org,
    )
    .await?;

    // id -> display name, and id -> debug-level developer name.
    let mut name_by_id: HashMap<String, String> = HashMap::new();
    let mut entities: Vec<EntityOption> = Vec::new();
    for u in &users {
        let display = match (&u.name, &u.username) {
            (Some(n), Some(un)) => format!("{n} ({un})"),
            (Some(n), None) => n.clone(),
            (None, Some(un)) => un.clone(),
            (None, None) => u.id.clone(),
        };
        name_by_id.insert(u.id.clone(), display.clone());
        entities.push(EntityOption {
            id: u.id.clone(),
            name: display,
            kind: EntityKind::User,
            keywords: u.email.iter().cloned().collect(),
        });
    }
    for c in &classes {
        let n = c.name.clone().unwrap_or_else(|| c.id.clone());
        name_by_id.insert(c.id.clone(), n.clone());
        entities.push(EntityOption {
            id: c.id.clone(),
            name: n,
            kind: EntityKind::ApexClass,
            keywords: Vec::new(),
        });
    }
    for t in &triggers {
        let n = t.name.clone().unwrap_or_else(|| t.id.clone());
        name_by_id.insert(t.id.clone(), n.clone());
        entities.push(EntityOption {
            id: t.id.clone(),
            name: n,
            kind: EntityKind::ApexTrigger,
            keywords: Vec::new(),
        });
    }

    let dl_name_by_id: HashMap<String, String> = raw_levels
        .iter()
        .map(|d| (d.id.clone(), d.developer_name.clone()))
        .collect();

    let debug_levels = raw_levels
        .into_iter()
        .map(|d| DebugLevelInfo {
            id: d.id,
            developer_name: d.developer_name,
            levels: levels_from(&d.fields),
        })
        .collect();

    let trace_flags = raw_flags
        .into_iter()
        .map(|f| {
            let kind = EntityKind::from_id(&f.traced_entity_id);
            TraceFlagInfo {
                traced_entity_name: name_by_id
                    .get(&f.traced_entity_id)
                    .cloned()
                    .unwrap_or_else(|| f.traced_entity_id.clone()),
                traced_entity_kind: kind,
                debug_level_name: dl_name_by_id
                    .get(&f.debug_level_id)
                    .cloned()
                    .unwrap_or_default(),
                creator_name: f.created_by.and_then(|c| c.name).unwrap_or_default(),
                log_type: f.log_type.unwrap_or_default(),
                start_date: f.start_date,
                expiration_date: f.expiration_date,
                traced_entity_id: f.traced_entity_id,
                debug_level_id: f.debug_level_id,
                id: f.id,
            }
        })
        .collect();

    Ok(LoggingConfig {
        trace_flags,
        debug_levels,
        entities,
    })
}

// --------------------------------------------------------------------- writes

async fn dml_create(
    invoker: &SfInvoker,
    sobject: &str,
    values: &str,
    org: Option<&str>,
) -> Result<String, SfError> {
    let r: WriteResult = invoker
        .run_json(&with_org(
            vec![
                "data", "create", "record", "-t", "-s", sobject, "-v", values,
            ],
            org,
        ))
        .await?;
    Ok(r.id)
}

async fn dml_update(
    invoker: &SfInvoker,
    sobject: &str,
    id: &str,
    values: &str,
    org: Option<&str>,
) -> Result<(), SfError> {
    let _: WriteResult = invoker
        .run_json(&with_org(
            vec![
                "data", "update", "record", "-t", "-s", sobject, "-i", id, "-v", values,
            ],
            org,
        ))
        .await?;
    Ok(())
}

async fn dml_delete(
    invoker: &SfInvoker,
    sobject: &str,
    id: &str,
    org: Option<&str>,
) -> Result<(), SfError> {
    let _: WriteResult = invoker
        .run_json(&with_org(
            vec!["data", "delete", "record", "-t", "-s", sobject, "-i", id],
            org,
        ))
        .await?;
    Ok(())
}

fn err_text(e: &SfError) -> String {
    format!("{e:?}")
}

fn trace_flag_values(t: &TraceFlagDraft, debug_level_id: &str) -> String {
    let mut v = format!(
        "TracedEntityId={} DebugLevelId={} LogType={}",
        t.traced_entity_id, debug_level_id, t.log_type
    );
    if let Some(s) = &t.start_date {
        v.push_str(&format!(" StartDate={s}"));
    }
    if let Some(e) = &t.expiration_date {
        v.push_str(&format!(" ExpirationDate={e}"));
    }
    v
}

/// Apply a batch diff in dependency order:
/// DebugLevel inserts/updates → TraceFlag inserts/updates → TraceFlag deletes →
/// DebugLevel deletes. Per-record results are collected; one failure never
/// aborts independent records.
pub async fn save_logging_config(
    invoker: &SfInvoker,
    diff: &LoggingDiff,
    org: Option<&str>,
) -> Result<SaveOutcome, SfError> {
    let mut results = Vec::new();
    let mut key_to_id: HashMap<String, String> = HashMap::new();

    // 1. DebugLevel inserts (record local_key -> new id for dependent flags).
    for d in &diff.debug_levels_added {
        let values = format!(
            "DeveloperName={dn} MasterLabel={dn} {lvls}",
            dn = d.developer_name,
            lvls = d.levels.values_arg()
        );
        match dml_create(invoker, "DebugLevel", &values, org).await {
            Ok(id) => {
                key_to_id.insert(d.local_key.clone(), id.clone());
                results.push(RecordResult {
                    sobject: "DebugLevel".into(),
                    op: "create".into(),
                    id: Some(id),
                    ok: true,
                    error: None,
                });
            }
            Err(e) => results.push(RecordResult {
                sobject: "DebugLevel".into(),
                op: "create".into(),
                id: None,
                ok: false,
                error: Some(err_text(&e)),
            }),
        }
    }

    // 2. DebugLevel updates.
    for d in &diff.debug_levels_modified {
        let res = dml_update(invoker, "DebugLevel", &d.id, &d.levels.values_arg(), org).await;
        results.push(write_result(
            "DebugLevel",
            "update",
            Some(d.id.clone()),
            res,
        ));
    }

    // 3. TraceFlag inserts (resolve debug_level_ref via key_to_id when local).
    for t in &diff.trace_flags_added {
        let dl_id = key_to_id
            .get(&t.debug_level_ref)
            .cloned()
            .unwrap_or_else(|| t.debug_level_ref.clone());
        let values = trace_flag_values(t, &dl_id);
        match dml_create(invoker, "TraceFlag", &values, org).await {
            Ok(id) => results.push(RecordResult {
                sobject: "TraceFlag".into(),
                op: "create".into(),
                id: Some(id),
                ok: true,
                error: None,
            }),
            Err(e) => results.push(RecordResult {
                sobject: "TraceFlag".into(),
                op: "create".into(),
                id: None,
                ok: false,
                error: Some(err_text(&e)),
            }),
        }
    }

    // 4. TraceFlag updates (debug level + dates).
    for t in &diff.trace_flags_modified {
        let mut v = format!("DebugLevelId={}", t.debug_level_id);
        if let Some(s) = &t.start_date {
            v.push_str(&format!(" StartDate={s}"));
        }
        if let Some(e) = &t.expiration_date {
            v.push_str(&format!(" ExpirationDate={e}"));
        }
        let res = dml_update(invoker, "TraceFlag", &t.id, &v, org).await;
        results.push(write_result("TraceFlag", "update", Some(t.id.clone()), res));
    }

    // 5. TraceFlag deletes (before any referenced DebugLevel delete).
    for id in &diff.trace_flags_removed {
        let res = dml_delete(invoker, "TraceFlag", id, org).await;
        results.push(write_result("TraceFlag", "delete", Some(id.clone()), res));
    }

    // 6. DebugLevel deletes.
    for id in &diff.debug_levels_removed {
        let res = dml_delete(invoker, "DebugLevel", id, org).await;
        results.push(write_result("DebugLevel", "delete", Some(id.clone()), res));
    }

    Ok(SaveOutcome { results })
}

fn write_result(
    sobject: &str,
    op: &str,
    id: Option<String>,
    res: Result<(), SfError>,
) -> RecordResult {
    match res {
        Ok(()) => RecordResult {
            sobject: sobject.into(),
            op: op.into(),
            id,
            ok: true,
            error: None,
        },
        Err(e) => RecordResult {
            sobject: sobject.into(),
            op: op.into(),
            id,
            ok: false,
            error: Some(err_text(&e)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::{Arc, Mutex};

    fn scripted(responses: Vec<&'static str>, seen: Arc<Mutex<Vec<Vec<String>>>>) -> MockRunner {
        let idx = Arc::new(Mutex::new(0usize));
        MockRunner::new(move |_p, args| {
            seen.lock().unwrap().push(args.to_vec());
            let mut i = idx.lock().unwrap();
            let body = responses[*i];
            *i += 1;
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        })
    }

    fn q(records: &str) -> String {
        format!(r#"{{"status":0,"result":{{"records":[{records}],"totalSize":0,"done":true}}}}"#)
    }

    #[tokio::test]
    async fn load_joins_entity_and_level_names() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let responses = vec![
            // DebugLevel
            Box::leak(
                q(r#"{"Id":"7dl1","DeveloperName":"FINE_LOGS","ApexCode":"DEBUG","System":"INFO"}"#)
                    .into_boxed_str(),
            ) as &'static str,
            // TraceFlag (traced 005USER, level 7dl1, creator Admin)
            Box::leak(q(r#"{"Id":"7tf1","LogType":"USER_DEBUG","StartDate":null,"ExpirationDate":"2026-06-23T00:00:00.000+0000","TracedEntityId":"005USER","DebugLevelId":"7dl1","CreatedBy":{"Name":"Admin User"}}"#).into_boxed_str()),
            // Users
            // Email deliberately differs from Username — the picker must still find her by it.
            Box::leak(q(r#"{"Id":"005USER","Name":"Alice","Username":"alice@x.com","Email":"alice.a@corp.com"}"#).into_boxed_str()),
            // ApexClass
            Box::leak(q("").into_boxed_str()),
            // ApexTrigger
            Box::leak(q("").into_boxed_str()),
        ];
        let runner = scripted(responses, seen.clone());
        let invoker = SfInvoker::new(Arc::new(runner));

        let cfg = load_logging_config(&invoker, None).await.unwrap();
        assert_eq!(cfg.debug_levels.len(), 1);
        assert_eq!(cfg.debug_levels[0].developer_name, "FINE_LOGS");
        assert_eq!(cfg.debug_levels[0].levels.apex_code, LogLevel::Debug);
        assert_eq!(cfg.trace_flags.len(), 1);
        let tf = &cfg.trace_flags[0];
        assert_eq!(tf.traced_entity_name, "Alice (alice@x.com)");
        assert_eq!(tf.traced_entity_kind, EntityKind::User);
        assert_eq!(tf.debug_level_name, "FINE_LOGS");
        assert_eq!(tf.creator_name, "Admin User");
        assert_eq!(cfg.entities.len(), 1);
        assert_eq!(cfg.entities[0].keywords, vec!["alice.a@corp.com"]);
        // The user query must not cap results — a LIMIT hides users in large orgs.
        let calls = seen.lock().unwrap();
        let user_soql = calls
            .iter()
            .flatten()
            .find(|a| a.contains("FROM User"))
            .expect("user query");
        assert!(user_soql.contains("Email"), "{user_soql}");
        assert!(!user_soql.contains("LIMIT"), "{user_soql}");
    }

    #[tokio::test]
    async fn save_inserts_level_before_referencing_flag() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let responses = vec![
            r#"{"status":0,"result":{"id":"7dlNEW","success":true}}"#, // create DebugLevel
            r#"{"status":0,"result":{"id":"7tfNEW","success":true}}"#, // create TraceFlag
        ];
        let runner = scripted(responses, seen.clone());
        let invoker = SfInvoker::new(Arc::new(runner));

        let diff = LoggingDiff {
            debug_levels_added: vec![DebugLevelDraft {
                local_key: "tmp1".into(),
                developer_name: "TEMP_LVL".into(),
                levels: crate::debug_config::preset_levels(crate::debug_config::Preset::ApexOnly),
            }],
            trace_flags_added: vec![TraceFlagDraft {
                log_type: "USER_DEBUG".into(),
                traced_entity_id: "005USER".into(),
                debug_level_ref: "tmp1".into(), // local key -> resolves to 7dlNEW
                start_date: None,
                expiration_date: Some("2026-06-23T00:00:00.000+0000".into()),
            }],
            ..Default::default()
        };

        let out = save_logging_config(&invoker, &diff, None).await.unwrap();
        assert_eq!(out.results.len(), 2);
        assert!(out.results.iter().all(|r| r.ok));

        let calls = seen.lock().unwrap();
        // First call creates the DebugLevel.
        assert!(calls[0].contains(&"DebugLevel".to_string()));
        assert!(calls[0].contains(&"create".to_string()));
        // Second call creates the TraceFlag referencing the new level id.
        assert!(calls[1].contains(&"TraceFlag".to_string()));
        let tf_values = calls[1].join(" ");
        assert!(
            tf_values.contains("DebugLevelId=7dlNEW"),
            "expected resolved level id, got: {tf_values}"
        );
    }

    #[tokio::test]
    async fn save_deletes_flag_before_level() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let responses = vec![
            r#"{"status":0,"result":{"id":"7tfX","success":true}}"#, // delete TraceFlag
            r#"{"status":0,"result":{"id":"7dlX","success":true}}"#, // delete DebugLevel
        ];
        let runner = scripted(responses, seen.clone());
        let invoker = SfInvoker::new(Arc::new(runner));

        let diff = LoggingDiff {
            trace_flags_removed: vec!["7tfX".into()],
            debug_levels_removed: vec!["7dlX".into()],
            ..Default::default()
        };
        let out = save_logging_config(&invoker, &diff, None).await.unwrap();
        assert!(out.results.iter().all(|r| r.ok));

        let calls = seen.lock().unwrap();
        assert!(
            calls[0].contains(&"TraceFlag".to_string()) && calls[0].contains(&"delete".to_string())
        );
        assert!(
            calls[1].contains(&"DebugLevel".to_string())
                && calls[1].contains(&"delete".to_string())
        );
    }
}
