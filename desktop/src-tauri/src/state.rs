//! Managed Tauri state: the shared [`AppState`] plus the single-entry parsed-log
//! cache and its accessors.

use std::sync::Arc;

use sf_core::SfInvoker;

/// Shared application state: one `SfInvoker` over the real `sf` CLI process runner.
pub struct AppState {
    pub(crate) invoker: SfInvoker,
    pub(crate) selected_org: std::sync::Mutex<Option<String>>,
    pub(crate) apex: features::apex_complete::ApexCompleter,
    /// Cached sObject-name list per org, for FROM completion. Populated by
    /// `warm_schema`/`refresh_schema_cache` so keystroke completion never blocks
    /// on a live (multi-second) `sf sobject list`.
    pub(crate) sobjects: std::sync::Mutex<std::collections::HashMap<String, Arc<Vec<String>>>>,
    /// In-flight SOQL runs, keyed by the frontend's query id, so `cancel_soql`
    /// can signal the paginating loop to stop.
    pub(crate) query_cancels:
        std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    /// Cached REST credentials per org (key: org or "" for default). Avoids a
    /// ~1-2s `sf org display` on every query — refreshed on a 401.
    pub(crate) auth_cache: std::sync::Mutex<std::collections::HashMap<String, sf_core::AuthInfo>>,
    /// Last parsed log (keyed by a hash of its raw body), shared by the viewer
    /// and the step-debugger so the same body is parsed exactly once.
    pub(crate) log_cache: std::sync::Mutex<Option<LogCacheEntry>>,
}

/// Single-entry cache for the most recently used log body: the base
/// `ParsedLog` (step-debugger) plus the `DebugLogView` derived from it
/// lazily on the first viewer call.
pub(crate) struct LogCacheEntry {
    key: u64,
    parsed: Arc<log_parser::parse::ParsedLog>,
    view: Option<Arc<features::debug_log::DebugLogView>>,
}

fn body_key(body: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    body.hash(&mut hasher);
    hasher.finish()
}

/// Read the currently selected target org as an owned value (guard not held across `.await`).
pub(crate) fn current_org(state: &AppState) -> Option<String> {
    state.selected_org.lock().unwrap().clone()
}

/// The full `DebugLogView` for a body, derived from (and cached alongside) the
/// shared `ParsedLog` so `parse_log`, `source_at_line`, and `get_log` over the
/// same log neither re-parse 200k+ lines nor rebuild the view per call.
pub(crate) fn cached_log_view(
    state: &AppState,
    body: &str,
) -> Arc<features::debug_log::DebugLogView> {
    let key = body_key(body);
    let mut cache = state.log_cache.lock().unwrap();
    if let Some(entry) = cache.as_mut() {
        if entry.key == key {
            if let Some(view) = &entry.view {
                return view.clone();
            }
            let view = Arc::new(features::debug_log::DebugLogView::from_parsed(
                &entry.parsed,
                body,
            ));
            entry.view = Some(view.clone());
            return view;
        }
    }
    let parsed = Arc::new(log_parser::parse::ParsedLog::parse(body));
    let view = Arc::new(features::debug_log::DebugLogView::from_parsed(&parsed, body));
    *cache = Some(LogCacheEntry {
        key,
        parsed,
        view: Some(view.clone()),
    });
    view
}

/// Parse a raw log body, reusing the cached parse when the body is unchanged so
/// the step-debugger doesn't re-parse a large log on every step. Shares the
/// viewer's cache entry, so a log opened then debugged is parsed once total.
pub(crate) fn parsed_log(state: &AppState, raw: &str) -> Arc<log_parser::parse::ParsedLog> {
    let key = body_key(raw);
    let mut cache = state.log_cache.lock().unwrap();
    if let Some(entry) = cache.as_ref() {
        if entry.key == key {
            return entry.parsed.clone();
        }
    }
    let parsed = Arc::new(log_parser::parse::ParsedLog::parse(raw));
    *cache = Some(LogCacheEntry {
        key,
        parsed: parsed.clone(),
        view: None,
    });
    parsed
}
