//! Configure anonymous-Apex debug verbosity via Tooling DebugLevel + TraceFlag.

use serde::Deserialize;
use sf_core::{SfError, SfInvoker};

/// A Salesforce debug-log level. `as_sf`/`from_sf` bridge to sf strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    None,
    Error,
    Warn,
    Info,
    Fine,
    Finer,
    Finest,
    Debug,
}

impl LogLevel {
    pub fn as_sf(self) -> &'static str {
        match self {
            LogLevel::None => "NONE",
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Fine => "FINE",
            LogLevel::Finer => "FINER",
            LogLevel::Finest => "FINEST",
            LogLevel::Debug => "DEBUG",
        }
    }
    pub fn from_sf(s: &str) -> LogLevel {
        match s {
            "ERROR" => LogLevel::Error,
            "WARN" => LogLevel::Warn,
            "INFO" => LogLevel::Info,
            "FINE" => LogLevel::Fine,
            "FINER" => LogLevel::Finer,
            "FINEST" => LogLevel::Finest,
            "DEBUG" => LogLevel::Debug,
            _ => LogLevel::None,
        }
    }
}

/// The eleven DebugLevel category levels (Tooling field name in the comment).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CategoryLevels {
    pub apex_code: LogLevel,      // ApexCode
    pub apex_profiling: LogLevel, // ApexProfiling
    pub callout: LogLevel,        // Callout
    pub data_access: LogLevel,    // DataAccess
    pub database: LogLevel,       // Database
    pub nba: LogLevel,            // Nba
    pub system: LogLevel,         // System
    pub validation: LogLevel,     // Validation
    pub visualforce: LogLevel,    // Visualforce
    pub wave: LogLevel,           // Wave
    pub workflow: LogLevel,       // Workflow
}

impl CategoryLevels {
    /// Space-separated `Field=LEVEL` pairs for `sf data ... -v`.
    pub fn values_arg(&self) -> String {
        [
            ("ApexCode", self.apex_code),
            ("ApexProfiling", self.apex_profiling),
            ("Callout", self.callout),
            ("DataAccess", self.data_access),
            ("Database", self.database),
            ("Nba", self.nba),
            ("System", self.system),
            ("Validation", self.validation),
            ("Visualforce", self.visualforce),
            ("Wave", self.wave),
            ("Workflow", self.workflow),
        ]
        .iter()
        .map(|(f, l)| format!("{f}={}", l.as_sf()))
        .collect::<Vec<_>>()
        .join(" ")
    }
}

/// A predefined verbosity preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    None,
    ApexOnly,
    FullDebugging,
}

const ALL_NONE: CategoryLevels = CategoryLevels {
    apex_code: LogLevel::None,
    apex_profiling: LogLevel::None,
    callout: LogLevel::None,
    data_access: LogLevel::None,
    database: LogLevel::None,
    nba: LogLevel::None,
    system: LogLevel::None,
    validation: LogLevel::None,
    visualforce: LogLevel::None,
    wave: LogLevel::None,
    workflow: LogLevel::None,
};

/// Pure: a preset → its category map (single source of truth, mirrored in TS).
pub fn preset_levels(p: Preset) -> CategoryLevels {
    match p {
        Preset::None => ALL_NONE,
        Preset::ApexOnly => CategoryLevels {
            apex_code: LogLevel::Debug,
            system: LogLevel::Debug,
            ..ALL_NONE
        },
        Preset::FullDebugging => CategoryLevels {
            apex_code: LogLevel::Finest,
            apex_profiling: LogLevel::Finest,
            callout: LogLevel::Finest,
            data_access: LogLevel::Finest,
            database: LogLevel::Finest,
            nba: LogLevel::Fine,
            system: LogLevel::Fine,
            validation: LogLevel::Info,
            visualforce: LogLevel::Finer,
            wave: LogLevel::Finer,
            workflow: LogLevel::Finer,
        },
    }
}

/// The running user's tool-owned debug config.
#[derive(Debug, Clone)]
pub struct DebugConfig {
    pub trace_flag_id: Option<String>,
    pub debug_level_id: Option<String>,
    pub levels: CategoryLevels,
}

const DL_DEVELOPER_NAME: &str = "SF_TOOLKIT_DEBUG";

#[derive(Deserialize)]
struct CreateResult {
    #[allow(dead_code)]
    id: String,
}
#[derive(Deserialize)]
struct OrgDisplay {
    username: String,
}
#[derive(Deserialize)]
struct UserIdRow {
    #[serde(rename = "Id")]
    id: String,
}
#[derive(Deserialize)]
struct UserIdRecords {
    records: Vec<UserIdRow>,
}
#[derive(Deserialize)]
struct TraceFlagRow {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "DebugLevelId")]
    debug_level_id: String,
}
#[derive(Deserialize)]
struct QueryRecords {
    records: Vec<TraceFlagRow>,
}

#[derive(Deserialize)]
struct DebugLevelFields {
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

#[derive(Deserialize)]
struct TraceFlagFull {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "DebugLevelId")]
    debug_level_id: String,
    #[serde(rename = "DebugLevel")]
    debug_level: Option<DebugLevelFields>,
}

#[derive(Deserialize)]
struct QueryFull {
    records: Vec<TraceFlagFull>,
}

fn with_org<'a>(mut args: Vec<&'a str>, org: Option<&'a str>) -> Vec<&'a str> {
    if let Some(o) = org {
        args.push("--target-org");
        args.push(o);
    }
    args
}

/// Running user's Id. `sf org display`'s `result.id` is the *org* Id (00D…), NOT the
/// user Id — verified against sf 2.127 / staging — so resolve the user Id from the
/// username via a standard `User` query.
async fn running_user_id(invoker: &SfInvoker, org: Option<&str>) -> Result<String, SfError> {
    let d: OrgDisplay = invoker
        .run_json(&with_org(vec!["org", "display"], org))
        .await?;
    let username = d.username;
    let soql = format!("SELECT Id FROM User WHERE Username='{username}'");
    let q: UserIdRecords = invoker
        .run_json(&with_org(vec!["data", "query", "-q", &soql], org))
        .await?;
    q.records
        .into_iter()
        .next()
        .map(|r| r.id)
        .ok_or_else(|| SfError::Unexpected(format!("no User found for {username}")))
}

/// Existing tool-owned (Id, DebugLevelId) for the user, if any.
async fn existing_trace_flag(
    invoker: &SfInvoker,
    user_id: &str,
    org: Option<&str>,
) -> Result<Option<(String, String)>, SfError> {
    let soql = format!(
        "SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId='{user_id}' AND LogType='DEVELOPER_LOG' LIMIT 1"
    );
    let q: QueryRecords = invoker
        .run_json(&with_org(vec!["data", "query", "-q", &soql, "-t"], org))
        .await?;
    Ok(q.records
        .into_iter()
        .next()
        .map(|r| (r.id, r.debug_level_id)))
}

/// Upsert the running user's DebugLevel + TraceFlag so runs log at `levels`.
pub async fn set_debug_config(
    invoker: &SfInvoker,
    levels: &CategoryLevels,
    target_org: Option<&str>,
) -> Result<DebugConfig, SfError> {
    let user_id = running_user_id(invoker, target_org).await?;
    let existing = existing_trace_flag(invoker, &user_id, target_org).await?;
    let values = levels.values_arg();

    let (trace_flag_id, debug_level_id) = match existing {
        Some((tf_id, dl_id)) => {
            // update DebugLevel categories
            let _: CreateResult = invoker
                .run_json(&with_org(
                    vec![
                        "data",
                        "update",
                        "record",
                        "-t",
                        "-s",
                        "DebugLevel",
                        "-i",
                        &dl_id,
                        "-v",
                        &values,
                    ],
                    target_org,
                ))
                .await?;
            // refresh the TraceFlag window
            let exp = expiration();
            let tf_values = format!("ExpirationDate={exp}");
            let _: CreateResult = invoker
                .run_json(&with_org(
                    vec![
                        "data",
                        "update",
                        "record",
                        "-t",
                        "-s",
                        "TraceFlag",
                        "-i",
                        &tf_id,
                        "-v",
                        &tf_values,
                    ],
                    target_org,
                ))
                .await?;
            (tf_id, dl_id)
        }
        None => {
            let dl_values = format!(
                "DeveloperName={DL_DEVELOPER_NAME} MasterLabel={DL_DEVELOPER_NAME} {values}"
            );
            let dl: CreateResult = invoker
                .run_json(&with_org(
                    vec![
                        "data",
                        "create",
                        "record",
                        "-t",
                        "-s",
                        "DebugLevel",
                        "-v",
                        &dl_values,
                    ],
                    target_org,
                ))
                .await?;
            let exp = expiration();
            let tf_values = format!(
                "TracedEntityId={user_id} DebugLevelId={dl_id} LogType=DEVELOPER_LOG ExpirationDate={exp}",
                dl_id = dl.id
            );
            let tf: CreateResult = invoker
                .run_json(&with_org(
                    vec![
                        "data",
                        "create",
                        "record",
                        "-t",
                        "-s",
                        "TraceFlag",
                        "-v",
                        &tf_values,
                    ],
                    target_org,
                ))
                .await?;
            (tf.id, dl.id)
        }
    };

    Ok(DebugConfig {
        trace_flag_id: Some(trace_flag_id),
        debug_level_id: Some(debug_level_id),
        levels: *levels,
    })
}

fn lvl(level: &Option<String>) -> LogLevel {
    level
        .as_deref()
        .map(LogLevel::from_sf)
        .unwrap_or(LogLevel::None)
}

impl From<DebugLevelFields> for CategoryLevels {
    fn from(d: DebugLevelFields) -> Self {
        CategoryLevels {
            apex_code: lvl(&d.apex_code),
            apex_profiling: lvl(&d.apex_profiling),
            callout: lvl(&d.callout),
            data_access: lvl(&d.data_access),
            database: lvl(&d.database),
            nba: lvl(&d.nba),
            system: lvl(&d.system),
            validation: lvl(&d.validation),
            visualforce: lvl(&d.visualforce),
            wave: lvl(&d.wave),
            workflow: lvl(&d.workflow),
        }
    }
}

/// Read the running user's debug config. Missing TraceFlag or DebugLevel means all-None.
pub async fn get_debug_config(
    invoker: &SfInvoker,
    target_org: Option<&str>,
) -> Result<DebugConfig, SfError> {
    let user_id = running_user_id(invoker, target_org).await?;
    let soql = format!(
        "SELECT Id, DebugLevelId, DebugLevel.ApexCode, DebugLevel.ApexProfiling, DebugLevel.Callout, \
         DebugLevel.DataAccess, DebugLevel.Database, DebugLevel.Nba, DebugLevel.System, DebugLevel.Validation, \
         DebugLevel.Visualforce, DebugLevel.Wave, DebugLevel.Workflow FROM TraceFlag \
         WHERE TracedEntityId='{user_id}' AND LogType='DEVELOPER_LOG' LIMIT 1"
    );
    let q: QueryFull = invoker
        .run_json(&with_org(
            vec!["data", "query", "-q", &soql, "-t"],
            target_org,
        ))
        .await?;

    let Some(tf) = q.records.into_iter().next() else {
        return Ok(DebugConfig {
            trace_flag_id: None,
            debug_level_id: None,
            levels: ALL_NONE,
        });
    };

    Ok(DebugConfig {
        trace_flag_id: Some(tf.id),
        debug_level_id: Some(tf.debug_level_id),
        levels: tf.debug_level.map(CategoryLevels::from).unwrap_or(ALL_NONE),
    })
}

/// Now + 24h as an sf datetime literal. No new crate: epoch → civil UTC by hand.
fn expiration() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + 24 * 3600;
    format_iso_utc(secs)
}

/// Epoch seconds → `YYYY-MM-DDThh:mm:ss.000+0000` (Howard Hinnant's civil-from-days).
fn format_iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.000+0000")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_none_is_all_none() {
        let l = preset_levels(Preset::None);
        assert_eq!(l.apex_code, LogLevel::None);
        assert_eq!(l.workflow, LogLevel::None);
    }

    #[test]
    fn preset_apex_only_sets_apex_and_system() {
        let l = preset_levels(Preset::ApexOnly);
        assert_eq!(l.apex_code, LogLevel::Debug);
        assert_eq!(l.system, LogLevel::Debug);
        assert_eq!(l.database, LogLevel::None);
    }

    #[test]
    fn preset_full_debugging_matches_ic2_debug_map() {
        let l = preset_levels(Preset::FullDebugging);
        assert_eq!(l.apex_code, LogLevel::Finest);
        assert_eq!(l.system, LogLevel::Fine);
        assert_eq!(l.validation, LogLevel::Info);
    }

    #[test]
    fn values_arg_uses_tooling_field_names() {
        let arg = preset_levels(Preset::ApexOnly).values_arg();
        assert!(arg.contains("ApexCode=DEBUG"), "got: {arg}");
        assert!(arg.contains("System=DEBUG"), "got: {arg}");
        assert!(arg.contains("Workflow=NONE"), "got: {arg}");
    }

    use sf_core::runner::MockRunner;
    use std::sync::{Arc, Mutex};

    /// MockRunner that returns a scripted sequence and records every arg vector seen.
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

    // org display → username; User query → user Id (the resolved-TODO path).
    const ORG_DISPLAY: &str = r#"{"status":0,"result":{"id":"00DORG","username":"me@x.com"}}"#;
    const USER_QUERY: &str =
        r#"{"status":0,"result":{"records":[{"Id":"005USER"}],"totalSize":1,"done":true}}"#;

    #[tokio::test]
    async fn set_debug_config_create_path() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                ORG_DISPLAY,
                USER_QUERY,
                r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#, // existing TraceFlag query
                r#"{"status":0,"result":{"id":"7dlDL","success":true}}"#, // create DebugLevel
                r#"{"status":0,"result":{"id":"7tfTF","success":true}}"#, // create TraceFlag
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = set_debug_config(&invoker, &preset_levels(Preset::ApexOnly), Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(cfg.debug_level_id.as_deref(), Some("7dlDL"));
        assert_eq!(cfg.trace_flag_id.as_deref(), Some("7tfTF"));
        let calls = seen.lock().unwrap().clone();
        let flat: Vec<String> = calls.iter().flatten().cloned().collect();
        assert!(
            flat.windows(2).any(|w| w == ["-s", "DebugLevel"]),
            "{flat:?}"
        );
        assert!(
            flat.windows(2).any(|w| w == ["-s", "TraceFlag"]),
            "{flat:?}"
        );
        assert!(flat.iter().any(|a| a == "-t"), "{flat:?}");
        assert!(
            flat.windows(2).any(|w| w == ["--target-org", "me@x.com"]),
            "{flat:?}"
        );
    }

    #[tokio::test]
    async fn set_debug_config_update_path() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                ORG_DISPLAY,
                USER_QUERY,
                r#"{"status":0,"result":{"records":[{"Id":"7tfTF","DebugLevelId":"7dlDL"}],"totalSize":1,"done":true}}"#,
                r#"{"status":0,"result":{"id":"7dlDL","success":true}}"#, // update DebugLevel
                r#"{"status":0,"result":{"id":"7tfTF","success":true}}"#, // update TraceFlag
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        set_debug_config(&invoker, &preset_levels(Preset::None), None)
            .await
            .unwrap();
        let flat: Vec<String> = seen.lock().unwrap().iter().flatten().cloned().collect();
        assert!(flat.iter().any(|a| a == "update"), "{flat:?}");
        assert!(flat.windows(2).any(|w| w == ["-i", "7dlDL"]), "{flat:?}");
        assert!(
            !flat.windows(2).any(|w| w[0] == "--target-org"),
            "no org when None: {flat:?}"
        );
    }

    #[test]
    fn format_iso_utc_is_28_chars_with_utc_suffix() {
        let s = format_iso_utc(1_750_000_000); // arbitrary epoch
        assert_eq!(s.len(), 28, "got: {s}");
        assert!(s.ends_with("+0000"), "got: {s}");
        assert_eq!(&s[10..11], "T", "got: {s}");
    }

    #[tokio::test]
    async fn get_debug_config_maps_levels() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                ORG_DISPLAY,
                USER_QUERY,
                r#"{"status":0,"result":{"records":[{"Id":"7tfTF","DebugLevelId":"7dlDL","DebugLevel":{"ApexCode":"DEBUG","System":"DEBUG","Database":"NONE","ApexProfiling":"NONE","Callout":"NONE","DataAccess":"NONE","Nba":"NONE","Validation":"NONE","Visualforce":"NONE","Wave":"NONE","Workflow":"NONE"}}],"totalSize":1,"done":true}}"#,
            ],
            seen.clone(),
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = get_debug_config(&invoker, None).await.unwrap();
        assert_eq!(cfg.levels.apex_code, LogLevel::Debug);
        assert_eq!(cfg.levels.database, LogLevel::None);
        assert_eq!(cfg.trace_flag_id.as_deref(), Some("7tfTF"));
        let flat: Vec<String> = seen.lock().unwrap().iter().flatten().cloned().collect();
        assert!(flat.iter().any(|a| a == "-t"), "{flat:?}");
    }

    #[tokio::test]
    async fn get_debug_config_absent_is_all_none() {
        let seen: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(vec![]));
        let runner = scripted(
            vec![
                ORG_DISPLAY,
                USER_QUERY,
                r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#,
            ],
            seen,
        );
        let invoker = SfInvoker::new(Arc::new(runner));
        let cfg = get_debug_config(&invoker, None).await.unwrap();
        assert_eq!(cfg.levels.apex_code, LogLevel::None);
        assert!(cfg.trace_flag_id.is_none());
    }
}
