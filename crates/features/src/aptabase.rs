//! Opt-in Aptabase remote sink. STRICT privacy contract: the `props` object
//! carries ONLY {outcome, durationMs, errorCategory?, isProd?} — never org
//! names/aliases, SOQL/Apex, record values or Ids, tokens, or raw error text.
//! `errorCategory` is a CLASSIFIED label from a fixed enum (see `classify_error`),
//! never a substring of the raw message. Enabled only when `remote_enabled`.
//! The POST is fire-and-forget (`tokio::spawn`): never awaited on the hot path,
//! never able to fail or alter a tool's result.

use crate::telemetry_config::TelemetryConfig;
use serde::Serialize;

/// Default public app key, shared by every Ultraforce binary that reports.
/// Overridable via `UF_OST_APTABASE_KEY` (name kept for compatibility with
/// existing uf-ost setups; the desktop app honours the same override).
const DEFAULT_APP_KEY: &str = "A-US-0354270195";

pub struct AptabaseClient {
    app_key: String,
    endpoint: String,
    session_id: String,
    /// Reporting app's own version + SDK label. Passed in: this crate is shared
    /// by the desktop app and the uf-ost binary, so `CARGO_PKG_VERSION` here
    /// would report the `features` crate's version for both.
    app_version: String,
    sdk_version: String,
    http: reqwest::Client,
}

/// Region-routed ingest endpoint. Pure — unit-tested.
pub fn endpoint_for_key(key: &str) -> Result<String, String> {
    if key.starts_with("A-US-") {
        Ok("https://us.aptabase.com/api/v0/event".to_string())
    } else if key.starts_with("A-EU-") {
        Ok("https://eu.aptabase.com/api/v0/event".to_string())
    } else if key.starts_with("A-SH-") {
        let host = std::env::var("UF_OST_APTABASE_HOST")
            .map_err(|_| "A-SH- app key requires UF_OST_APTABASE_HOST".to_string())?;
        Ok(format!("{host}/api/v0/event"))
    } else {
        Err(format!("unrecognized Aptabase app-key region: {key}"))
    }
}

/// Map a raw error message to a fixed, non-identifying label. The return value
/// is ALWAYS a `&'static str` literal — it can never contain any substring of
/// the caller's `msg`, which is the whole point of this function.
pub fn classify_error(msg: &str) -> &'static str {
    // Salesforce status codes (case-sensitive, checked first).
    if msg.contains("INVALID_FIELD") {
        return "INVALID_FIELD";
    }
    if msg.contains("MALFORMED_QUERY") {
        return "MALFORMED_QUERY";
    }
    if msg.contains("INVALID_SESSION_ID") {
        return "INVALID_SESSION_ID";
    }
    let low = msg.to_ascii_lowercase();
    if low.contains("timed out") || low.contains("timeout") {
        "timeout"
    } else if low.contains("auth") || low.contains("unauthorized") || low.contains("401") {
        "auth_failed"
    } else if low.contains("not found") || low.contains("no such") || low.contains("404") {
        "not_found"
    } else {
        "other"
    }
}

/// Stable-per-process session id: epoch millis plus a per-process suffix.
pub fn gen_session_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}{:05}", std::process::id() % 100_000)
}

/// `None` unless `remote_enabled`; resolves the app key (const or
/// `UF_OST_APTABASE_KEY`) and its region endpoint. A bad key region ⇒ `None`
/// (remote telemetry silently disabled, never a startup failure). Takes the
/// per-process `session_id` so it stays the single source of truth in `LiveCtx`.
pub fn new_if_enabled(
    cfg: &TelemetryConfig,
    session_id: &str,
    app_version: &str,
    sdk_version: &str,
) -> Option<AptabaseClient> {
    if !cfg.remote_enabled {
        return None;
    }
    new(session_id, app_version, sdk_version)
}

/// The client itself, independent of consent. Callers that re-check consent per
/// event (rather than at construction) build this once and gate each `track`.
/// `None` only when the app key's region is unrecognized.
pub fn new(session_id: &str, app_version: &str, sdk_version: &str) -> Option<AptabaseClient> {
    let app_key =
        std::env::var("UF_OST_APTABASE_KEY").unwrap_or_else(|_| DEFAULT_APP_KEY.to_string());
    let endpoint = endpoint_for_key(&app_key).ok()?;
    Some(AptabaseClient {
        app_key,
        endpoint,
        session_id: session_id.to_string(),
        app_version: app_version.to_string(),
        sdk_version: sdk_version.to_string(),
        http: reqwest::Client::new(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemProps {
    os_name: &'static str,
    os_version: &'static str,
    app_version: String,
    locale: &'static str,
    is_debug: bool,
    sdk_version: String,
}

/// The scrubbed payload. Structurally limited to the four allowed keys — the
/// two optional ones are OMITTED (not null) when absent. Nothing else can be
/// serialized here.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Props {
    outcome: String,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_prod: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventBody {
    timestamp: String,
    session_id: String,
    event_name: String,
    system_props: SystemProps,
    props: Props,
}

impl AptabaseClient {
    /// Build the scrubbed event and fire the POST detached. Returns immediately;
    /// the HTTP call is best-effort and cannot affect the originating tool.
    pub fn track(
        &self,
        tool: &str,
        outcome: &str,
        duration_ms: u64,
        error_category: Option<&str>,
        is_prod: Option<bool>,
    ) {
        let body = EventBody {
            timestamp: iso8601_now(),
            session_id: self.session_id.clone(),
            event_name: tool.to_string(),
            system_props: SystemProps {
                os_name: std::env::consts::OS,
                os_version: "",
                app_version: self.app_version.clone(),
                locale: "",
                is_debug: cfg!(debug_assertions),
                sdk_version: self.sdk_version.clone(),
            },
            props: Props {
                outcome: outcome.to_string(),
                duration_ms,
                // Already classified by the caller; a &'static label only.
                error_category: error_category.map(str::to_string),
                is_prod,
            },
        };
        let endpoint = self.endpoint.clone();
        let app_key = self.app_key.clone();
        let http = self.http.clone();
        tokio::spawn(async move {
            let _ = http
                .post(&endpoint)
                .header("App-Key", app_key)
                .json(&body)
                .send()
                .await;
        });
    }
}

/// ISO-8601 UTC (`YYYY-MM-DDThh:mm:ss.sssZ`) from the system clock, without a
/// date crate — days→civil via Howard Hinnant's algorithm.
fn iso8601_now() -> String {
    iso8601_at(std::time::SystemTime::now())
}

/// Pure formatting logic, split out from `iso8601_now` so the conversion can
/// be pinned against known instants instead of only the live clock.
fn iso8601_at(t: std::time::SystemTime) -> String {
    let now = t
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_region_from_key() {
        assert_eq!(
            endpoint_for_key("A-US-0354270195").unwrap(),
            "https://us.aptabase.com/api/v0/event"
        );
        assert_eq!(
            endpoint_for_key("A-EU-123").unwrap(),
            "https://eu.aptabase.com/api/v0/event"
        );
        assert!(endpoint_for_key("A-XX-1").is_err());
    }
    #[test]
    fn classify_never_returns_raw() {
        assert_eq!(
            classify_error("No such column 'Foo' INVALID_FIELD"),
            "INVALID_FIELD"
        );
        assert_eq!(classify_error("INVALID_SESSION_ID: expired"), "INVALID_SESSION_ID");
        assert_eq!(classify_error("something weird"), "other");
        // the classified label must not contain any of the raw message
        let raw = "secret ProjectX MALFORMED_QUERY details";
        let cat = classify_error(raw);
        assert!(!cat.contains("ProjectX") && !cat.contains("secret"), "{cat}");
    }

    #[test]
    fn civil_from_days_pins_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2024-01-01T00:00:00Z == epoch second 1704067200 == day 19723.
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        // 2000-02-29T00:00:00Z (leap day) == epoch second 951782400 == day 11016.
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn iso8601_at_pins_known_instants() {
        use std::time::{Duration, UNIX_EPOCH};
        assert_eq!(iso8601_at(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso8601_at(UNIX_EPOCH + Duration::from_secs(1_704_067_200)),
            "2024-01-01T00:00:00.000Z"
        );
        assert_eq!(
            iso8601_at(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00:00:00.000Z"
        );
        // Millis and time-of-day components both render.
        assert_eq!(
            iso8601_at(UNIX_EPOCH + Duration::from_millis(1_704_067_200_500)),
            "2024-01-01T00:00:00.500Z"
        );
    }
}
