//! Live-org plumbing shared by all live tools: cached auth, prod detection
//! (fail-safe: unknown ⇒ prod), and the write-confirm gate.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use features::telemetry_config::{self, TelemetryConfig};
use rmcp::ErrorData;
use sf_core::{AuthInfo, OrgRegistry, ProcessRunner, SfInvoker};

use features::aptabase::{self, AptabaseClient};
use crate::telemetry::{LogEntry, Telemetry};

pub mod apex;
pub mod dml;
pub mod query;
pub mod rest;

const AUTH_TTL: Duration = Duration::from_secs(15 * 60);

pub struct LiveCtx {
    auth: tokio::sync::Mutex<HashMap<String, (AuthInfo, Instant)>>,
    pub telemetry: Telemetry,
    /// Loaded once at startup. Gates local `tool_log` writes only — NOT the
    /// `org_meta` prod-detection cache, which is functional and always on.
    pub config: TelemetryConfig,
    /// Opt-in scrubbed remote sink; `None` unless `remote_enabled`.
    pub aptabase: Option<AptabaseClient>,
    /// Per-process session id shared with `aptabase`.
    pub session_id: String,
}

impl LiveCtx {
    pub fn new(root: PathBuf) -> Self {
        let config = telemetry_config::load(&root);
        let mut ctx = Self {
            auth: tokio::sync::Mutex::new(HashMap::new()),
            telemetry: Telemetry::new(root),
            config,
            aptabase: None,
            session_id: aptabase::gen_session_id(),
        };
        // Built from the stored session so `session_id` is the single source of truth.
        ctx.aptabase = aptabase::new_if_enabled(
            &ctx.config,
            &ctx.session_id,
            env!("CARGO_PKG_VERSION"),
            concat!("ultraforce-mcp@", env!("CARGO_PKG_VERSION")),
        );
        ctx
    }

    /// Cached `sf org display` auth. TTL 15 min — `sf org display` refreshes
    /// the token, so a re-fetch is always valid.
    pub async fn auth(&self, org: &str) -> Result<AuthInfo, ErrorData> {
        let mut cache = self.auth.lock().await;
        if let Some((info, at)) = cache.get(org) {
            if at.elapsed() < AUTH_TTL {
                return Ok(info.clone());
            }
        }
        let invoker = SfInvoker::new(std::sync::Arc::new(ProcessRunner));
        let info = OrgRegistry::auth_info(&invoker, Some(org))
            .await
            .map_err(|e| {
                ErrorData::invalid_params(
                    format!(
                        "cannot get auth for org '{org}': {e}. Is it authenticated in sf CLI?"
                    ),
                    None,
                )
            })?;
        cache.insert(org.to_string(), (info.clone(), Instant::now()));
        Ok(info)
    }

    /// Called by tools on `INVALID_SESSION_ID` so the next call re-fetches.
    pub async fn drop_auth(&self, org: &str) {
        self.auth.lock().await.remove(org);
    }

    /// Emit one tool call to both sinks. Local `tool_log` is opt-in
    /// (`local_enabled`); the remote Aptabase sink is opt-in and scrubbed —
    /// `errorCategory` is a CLASSIFIED label (never the raw message) and
    /// `isProd` reads the org_meta CACHE ONLY (never triggers a live query).
    pub fn record_telemetry(
        &self,
        tool: &'static str,
        org: Option<&str>,
        params: &str,
        outcome: &str,
        error: Option<&str>,
        duration_ms: u64,
    ) {
        if self.config.local_enabled {
            self.telemetry.log(LogEntry {
                tool,
                org,
                params,
                outcome,
                error,
                duration_ms,
            });
        }
        if let Some(ap) = &self.aptabase {
            let is_prod = org
                .and_then(|o| self.telemetry.get_org_meta(o))
                .map(|is_sandbox| !is_sandbox);
            let err_category = error.map(aptabase::classify_error);
            ap.track(tool, outcome, duration_ms, err_category, is_prod);
        }
    }

    /// Fail-safe prod detection: cached `Organization.IsSandbox`, one live
    /// query on miss; any failure ⇒ treat as production, do NOT cache.
    pub async fn is_prod(&self, org: &str) -> bool {
        if let Some(is_sandbox) = self.telemetry.get_org_meta(org) {
            return !is_sandbox;
        }
        let Ok(auth) = self.auth(org).await else {
            return true;
        };
        let cancel = AtomicBool::new(false);
        let res = features::soql::run_query_rest(
            &auth,
            "SELECT IsSandbox FROM Organization LIMIT 1",
            features::soql::QueryOptions::default(),
            &|_, _| {},
            &cancel,
        )
        .await;
        match res.ok().as_ref().and_then(parse_is_sandbox) {
            Some(is_sandbox) => {
                self.telemetry.set_org_meta(org, is_sandbox);
                !is_sandbox
            }
            None => true, // fail-safe: unknown ⇒ prod
        }
    }
}

pub fn parse_is_sandbox(qr: &features::soql::QueryResult) -> Option<bool> {
    let rec = qr.records.first()?;
    rec.fields.iter().find_map(|(name, v)| {
        if !name.eq_ignore_ascii_case("IsSandbox") {
            return None;
        }
        match v {
            features::soql::FieldValue::Scalar(serde_json::Value::Bool(b)) => Some(*b),
            _ => None,
        }
    })
}

/// The write-confirm rail. Every mutating tool calls this before touching the org.
pub fn gate_write(is_prod: bool, confirm: bool) -> Result<(), ErrorData> {
    if is_prod && !confirm {
        return Err(ErrorData::invalid_params(
            "This org is PRODUCTION (or its type could not be verified). Mutating it requires \
             explicit user approval: describe the change to the user, get their yes, then retry \
             with confirm: true."
                .to_string(),
            None,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use features::soql::{FieldValue, QueryResult, Record};

    fn qr(is_sandbox: bool) -> QueryResult {
        QueryResult {
            total_size: 1,
            done: true,
            records: vec![Record {
                sobject_type: "Organization".into(),
                fields: vec![(
                    "IsSandbox".into(),
                    FieldValue::Scalar(serde_json::Value::Bool(is_sandbox)),
                )],
            }],
        }
    }

    #[test]
    fn parses_is_sandbox() {
        assert_eq!(parse_is_sandbox(&qr(true)), Some(true));
        assert_eq!(parse_is_sandbox(&qr(false)), Some(false));
        let empty = QueryResult {
            total_size: 0,
            done: true,
            records: vec![],
        };
        assert_eq!(parse_is_sandbox(&empty), None);
    }

    #[test]
    fn gate_blocks_unconfirmed_prod_writes() {
        assert!(gate_write(false, false).is_ok()); // sandbox, no confirm needed
        assert!(gate_write(true, true).is_ok()); // prod, confirmed
        let err = gate_write(true, false).unwrap_err();
        assert!(err.message.contains("PRODUCTION"), "{}", err.message);
        assert!(err.message.contains("confirm"), "{}", err.message);
    }
}
