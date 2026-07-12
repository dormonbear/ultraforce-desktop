//! Process-global HTTP request timeout for the direct REST paths
//! (`soql::run_query_rest`, `rest_dml`) that bypass the `sf` CLI.
//!
//! `None` (the default) means **unbounded** — the pre-config behavior — so orgs
//! without a configured `timeoutSecs` never regress on long-running large
//! queries. Only a user-configured per-org value bounds these calls. The
//! composition root (src-tauri `org_config::apply_org_config`) sets this
//! alongside the `SfInvoker` timeout on org switch / config save, keeping this
//! crate tauri-free.

use sf_core::SfError;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

fn slot() -> &'static Mutex<Option<Duration>> {
    static S: OnceLock<Mutex<Option<Duration>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// Set (or clear, with `None`) the timeout applied to direct REST requests.
pub fn set_http_timeout(timeout: Option<Duration>) {
    *slot().lock().unwrap() = timeout;
}

/// The currently configured direct-REST timeout (`None` = unbounded).
pub fn http_timeout() -> Option<Duration> {
    *slot().lock().unwrap()
}

/// A reqwest client honoring the configured timeout. Without a configured
/// value the client has no timeout, matching `reqwest::Client::new()`.
pub(crate) fn client() -> reqwest::Client {
    let mut b = reqwest::Client::builder();
    if let Some(t) = http_timeout() {
        b = b.timeout(t);
    }
    b.build().unwrap_or_else(|_| reqwest::Client::new())
}

/// Map a reqwest send/read error to a readable [`SfError`], surfacing a
/// configured-timeout expiry as [`SfError::Timeout`] (IPC code "timeout")
/// instead of a raw reqwest debug string.
pub(crate) fn map_reqwest_error(e: reqwest::Error, context: &str) -> SfError {
    if e.is_timeout() {
        if let Some(t) = http_timeout() {
            return SfError::Timeout(t);
        }
    }
    SfError::Unexpected(format!("{context}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_round_trip_and_default() {
        // One test owns the global slot to avoid parallel-test races.
        assert_eq!(http_timeout(), None, "unconfigured must mean unbounded");
        set_http_timeout(Some(Duration::from_secs(90)));
        assert_eq!(http_timeout(), Some(Duration::from_secs(90)));
        // The builder path must not panic with a timeout configured.
        let _ = client();
        set_http_timeout(None);
        assert_eq!(http_timeout(), None, "cleared config restores unbounded");
        let _ = client();
    }
}
