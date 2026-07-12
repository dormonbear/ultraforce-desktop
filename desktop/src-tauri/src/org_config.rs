//! Per-org config (apiVersion / timeoutSecs / alias / color) read from the
//! shared tauri-plugin-store file the frontend writes (`ultraforce.json`, key
//! `orgConfig.<username>`). The plugin keeps a single in-memory `Store` per path
//! shared between JS and Rust, so a value the frontend `set` is visible here
//! immediately — no dedicated command or `AppState` cache is needed.
//!
//! This module is the composition-root seam that injects the effective API
//! version (into `features::api_version`) and the request timeouts (into the
//! shared `SfInvoker` for CLI calls and `features::http_timeout` for direct
//! REST calls) so the `sf-core` / `features` crates stay tauri-free.

use std::time::Duration;

use serde::Deserialize;
use tauri::{Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::state::AppState;

/// The JSON store file the frontend persists app state into.
const STORE_FILE: &str = "ultraforce.json";

/// Mirror of the frontend `OrgConfig` (only the fields Rust acts on are parsed;
/// alias/color are display-only and ignored here). camelCase to match the JSON
/// the JS side writes.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OrgConfig {
    pub api_version: Option<String>,
    pub timeout_secs: Option<u64>,
}

fn config_key(username: &str) -> String {
    format!("orgConfig.{username}")
}

/// Read the persisted config for `username` from the shared store. Any failure
/// (store unavailable, key absent, malformed) yields the default (all `None`).
pub fn read_org_config<R: Runtime, M: Manager<R>>(app: &M, username: &str) -> OrgConfig {
    let Ok(store) = app.store(STORE_FILE) else {
        return OrgConfig::default();
    };
    store
        .get(config_key(username))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Apply `username`'s persisted config to the backend: inject the per-org API
/// version override and set both request-timeout knobs — the shared invoker's
/// default (`sf` CLI calls; falls back to the built-in 120s) and the direct-REST
/// timeout (SOQL query / REST DML; unbounded when unconfigured, so unconfigured
/// orgs keep their pre-config long-query behavior). Called on org switch and
/// before each index run so a freshly-saved config takes effect.
pub fn apply_org_config<R: Runtime, M: Manager<R>>(app: &M, state: &AppState, username: &str) {
    let cfg = read_org_config(app, username);
    features::api_version::set_api_version_override(username, cfg.api_version);
    let configured = cfg.timeout_secs.filter(|s| *s > 0).map(Duration::from_secs);
    state.invoker.set_default_timeout(
        configured.unwrap_or_else(|| Duration::from_secs(sf_core::invoker::DEFAULT_TIMEOUT_SECS)),
    );
    features::http_timeout::set_http_timeout(configured);
}

/// Reset backend request bounds to the built-in defaults (used when the target
/// org is cleared): 120s for CLI calls, unbounded for direct REST.
pub fn reset_to_default(state: &AppState) {
    state
        .invoker
        .set_default_timeout(Duration::from_secs(sf_core::invoker::DEFAULT_TIMEOUT_SECS));
    features::http_timeout::set_http_timeout(None);
}
