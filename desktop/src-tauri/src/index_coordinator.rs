//! `IndexCoordinator` — the deep module that owns an org's index lifecycle.
//!
//! It consolidates what used to be three uncoordinated call sites (`warm_schema` +
//! `index_org` fired in parallel on startup / org-switch / a 5-min poll, plus a
//! manual reindex) into a single entry point with:
//!
//! - **single-flight per org**: concurrent `ensure_ready` calls for the same org
//!   join one in-flight run instead of racing (a per-org async gate);
//! - **freshness**: a just-completed org is a no-op within `FRESH_TTL`, so the
//!   startup effect + an immediate org-switch don't double-index (the 5-min poll
//!   is well past the TTL, so it always delta-syncs);
//! - a **queryable status snapshot** (`status`) so a late-subscribing progress
//!   indicator can seed its state on mount instead of missing the event stream;
//! - the old separate `warm_schema` sObject-name load folded into the run's first
//!   step (loaded once, up front — no more duplicate load at index completion).
//!
//! Runs are **per-org isolated**: a stale run for org A finishing after the user
//! switched to org B only writes A's status/caches, never B's. `features::index`
//! has no cancellation seam, so we don't cancel A — it completes harmlessly.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;

use crate::dto::{IndexProgressDto, IndexStatusDto, SyncResultDto};
use crate::error::CommandError;
use crate::state::AppState;

/// A completed index younger than this is considered fresh, so a redundant
/// `ensure_ready` (startup + immediate switch, React strict-mode double-mount)
/// no-ops. Kept well under the 5-min background poll so the poll always syncs.
const FRESH_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, PartialEq, Eq)]
enum RunState {
    Idle,
    Indexing,
    Ready,
    Error,
}

impl RunState {
    fn as_str(self) -> &'static str {
        match self {
            RunState::Idle => "idle",
            RunState::Indexing => "indexing",
            RunState::Ready => "ready",
            RunState::Error => "error",
        }
    }
}

/// Per-org, mutable status snapshot. Cheap to clone for a `status` read.
#[derive(Clone)]
struct OrgStatus {
    state: RunState,
    phase: Option<String>,
    done: Option<usize>,
    total: Option<usize>,
    /// Monotonic completion time, for the freshness check.
    completed_at: Option<Instant>,
    /// Wall-clock completion (epoch millis), for the UI's "last indexed".
    last_indexed_ms: Option<i64>,
    error: Option<String>,
}

impl Default for OrgStatus {
    fn default() -> Self {
        OrgStatus {
            state: RunState::Idle,
            phase: None,
            done: None,
            total: None,
            completed_at: None,
            last_indexed_ms: None,
            error: None,
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Owns per-org run gates (single-flight) and the queryable status map. Both maps
/// are guarded by plain `std::sync::Mutex`es held only briefly (never across an
/// `.await`); the long-held lock is the per-org async gate.
pub(crate) struct IndexCoordinator {
    gates: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    statuses: Mutex<HashMap<String, OrgStatus>>,
}

impl IndexCoordinator {
    pub(crate) fn new() -> Self {
        IndexCoordinator {
            gates: Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
        }
    }

    fn gate_for(&self, org: &str) -> Arc<AsyncMutex<()>> {
        self.gates
            .lock()
            .unwrap()
            .entry(org.to_string())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    fn is_fresh(&self, org: &str) -> bool {
        let map = self.statuses.lock().unwrap();
        match map.get(org) {
            Some(s) if s.state == RunState::Ready => {
                s.completed_at.map(|t| t.elapsed() < FRESH_TTL).unwrap_or(false)
            }
            _ => false,
        }
    }

    fn update<F: FnOnce(&mut OrgStatus)>(&self, org: &str, f: F) {
        let mut map = self.statuses.lock().unwrap();
        f(map.entry(org.to_string()).or_default());
    }

    fn set_indexing(&self, org: &str) {
        self.update(org, |s| {
            s.state = RunState::Indexing;
            s.error = None;
            s.phase = None;
            s.done = None;
            s.total = None;
        });
    }

    /// Record live per-phase progress, so a `status` read mid-run reflects it.
    pub(crate) fn set_progress(&self, org: &str, phase: &str, done: usize, total: usize) {
        self.update(org, |s| {
            s.state = RunState::Indexing;
            s.phase = Some(phase.to_string());
            s.done = Some(done);
            s.total = Some(total);
        });
    }

    fn set_ready(&self, org: &str) {
        self.update(org, |s| {
            s.state = RunState::Ready;
            s.phase = None;
            s.done = None;
            s.total = None;
            s.error = None;
            s.completed_at = Some(Instant::now());
            s.last_indexed_ms = Some(now_ms());
        });
    }

    fn set_error(&self, org: &str, message: String) {
        self.update(org, |s| {
            s.state = RunState::Error;
            s.phase = None;
            s.done = None;
            s.total = None;
            s.error = Some(message);
        });
    }

    pub(crate) fn status(&self, org: &str) -> IndexStatusDto {
        let s = self
            .statuses
            .lock()
            .unwrap()
            .get(org)
            .cloned()
            .unwrap_or_default();
        IndexStatusDto {
            org: org.to_string(),
            state: s.state.as_str().to_string(),
            phase: s.phase,
            done: s.done,
            total: s.total,
            last_indexed: s.last_indexed_ms,
            error: s.error,
        }
    }

    /// Single-flight core: acquire the org's gate (concurrent callers queue), then
    /// either no-op (fresh, unless `force`) or run `run` under an Indexing→Ready/
    /// Error status transition. Generic over `run` so the state machine is unit-
    /// testable without any live-org IO.
    pub(crate) async fn coordinate<F, Fut>(
        &self,
        org: String,
        force: bool,
        run: F,
    ) -> Result<(), CommandError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<(), CommandError>>,
    {
        let gate = self.gate_for(&org);
        let _g = gate.lock().await;
        if !force && self.is_fresh(&org) {
            return Ok(());
        }
        self.set_indexing(&org);
        let r = run().await;
        match &r {
            Ok(()) => self.set_ready(&org),
            Err(e) => self.set_error(&org, e.message.clone()),
        }
        r
    }
}

/// Idempotent "make this org's index usable". No-op when fresh; otherwise loads
/// the sObject-name cache (folded `warm_schema`), then installs the Apex snapshot
/// and delta-syncs, or runs a full first index. Single-flight per org.
pub(crate) async fn ensure_ready(
    app: &AppHandle,
    state: &AppState,
    org: String,
    namespaces: Option<String>,
) -> Result<(), CommandError> {
    let res = state
        .index
        .coordinate(org.clone(), false, || {
            run_index(app, state, org.clone(), namespaces, false)
        })
        .await;
    emit_done(app, &org);
    res
}

/// Forced full rebuild: clears the cached schema then re-indexes. If a run is in
/// flight it is **queued** (waits on the same per-org gate) rather than
/// superseded — `features::index` exposes no cancellation seam, and queueing
/// guarantees two runs never mutate the shared caches concurrently. The extra
/// wait for an in-flight sync to finish first is cheap next to a rebuild.
pub(crate) async fn reindex(
    app: &AppHandle,
    state: &AppState,
    org: String,
    namespaces: Option<String>,
) -> Result<(), CommandError> {
    let res = state
        .index
        .coordinate(org.clone(), true, || {
            run_index(app, state, org.clone(), namespaces, true)
        })
        .await;
    emit_done(app, &org);
    res
}

/// Terminal event so any progress pill scoped to this org clears (idempotent —
/// the full-index path already emits a final `done`, and idle/delta paths never
/// showed a pill, so a redundant `done` is harmless).
fn emit_done(app: &AppHandle, org: &str) {
    let _ = app.emit(
        "index-progress",
        IndexProgressDto {
            org: org.to_string(),
            phase: "done".to_string(),
            done: 0,
            total: 0,
        },
    );
}

/// The actual indexing IO, run under the coordinator's gate + status transition.
/// Ports the former `indexing::index_org`, with the sObject-name load hoisted to
/// the front (folding `warm_schema`) so FROM completion is ready before the heavy
/// Apex work, and no longer re-loaded at the end.
async fn run_index(
    app: &AppHandle,
    state: &AppState,
    org: String,
    namespaces: Option<String>,
    force: bool,
) -> Result<(), CommandError> {
    let started = Instant::now();
    tracing::info!(org = %org, force, "run_index start");
    // 1. sObject names first (folded `warm_schema`): FROM completion is ready
    //    immediately, even if the heavier Apex index below stalls on a large org.
    let names = features::soql::list_sobject_names(&state.invoker, &org).await;
    state
        .sobjects
        .lock()
        .unwrap()
        .insert(org.clone(), Arc::new(names));

    let root = features::apex_complete::default_index_root();
    // Re-read the per-org config so a just-saved apiVersion override is in effect
    // before we resolve the effective version — otherwise the snapshot staleness
    // check (which rebuilds when api_version differs) would compare against a stale
    // override and skip the needed rebuild.
    crate::org_config::apply_org_config(app, state, &org);
    // Resolve the effective API version ONCE and thread it through the whole run
    // (snapshot load, delta sync, full index). When live detection fails, the
    // resolver reuses the snapshot's stored version so a good snapshot still
    // loads instead of being discarded by the fallback default; a genuine
    // detected-version change still rebuilds.
    let (api, detected) =
        features::api_version::resolve_index_api_version(&state.invoker, &root, &org).await;
    tracing::info!(org = %org, api = %api, detected, "run_index resolved api version");
    let policy = features::index::NamespacePolicy::parse(namespaces.as_deref().unwrap_or("all"));

    // Forced rebuild drops the cached schema so the next browse reflects current
    // metadata (matches the former `reindex_org`).
    if force {
        let mut store = sf_schema::SchemaStore::new(sf_schema::SchemaStore::default_root(), &org);
        let _ = store.clear();
    }

    // Already indexed → install the snapshot instantly (completion ready), then
    // delta-sync in the same run and emit a result if anything changed.
    if let Some((ost, _)) = apex_lang::load_snapshot(&root, &org, &api) {
        tracing::info!(org = %org, "run_index snapshot hit; installing + delta-syncing");
        state.apex.install_index(&org, ost);
        if let Ok((outcome, patched)) =
            features::index::sync_org(&state.invoker, root, &org, &api, &policy).await
        {
            state.apex.install_index(&org, patched);
            if outcome.changed() {
                let _ = app.emit(
                    "sync-result",
                    SyncResultDto {
                        org: org.clone(),
                        added: outcome.added,
                        updated: outcome.updated,
                        removed: outcome.removed,
                    },
                );
            }
        }
        tracing::info!(
            org = %org,
            elapsed_ms = started.elapsed().as_millis() as u64,
            "run_index complete (snapshot path)"
        );
        return Ok(());
    }

    tracing::info!(org = %org, "run_index snapshot miss; running full index");
    // Not indexed → full first index (Phase-1 path). Progress feeds both the
    // event stream and the queryable status snapshot.
    let mut on_progress = |p: features::index::IndexProgress| {
        state.index.set_progress(&org, p.phase, p.done, p.total);
        let _ = app.emit(
            "index-progress",
            IndexProgressDto {
                org: org.clone(),
                phase: p.phase.to_string(),
                done: p.done,
                total: p.total,
            },
        );
    };
    let ost =
        features::index::index_org(&state.invoker, root, &org, &api, &policy, &mut on_progress)
            .await
            .map_err(CommandError::from)?;
    state.apex.install_index(&org, ost);
    tracing::info!(
        org = %org,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "run_index complete (full index)"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn coord() -> IndexCoordinator {
        IndexCoordinator::new()
    }

    #[test]
    fn unknown_org_is_idle() {
        let c = coord();
        let s = c.status("nope@example.com");
        assert_eq!(s.state, "idle");
        assert!(s.last_indexed.is_none());
        assert!(s.error.is_none());
    }

    #[test]
    fn status_transitions_reflect_run_lifecycle() {
        let c = coord();
        c.set_indexing("o");
        assert_eq!(c.status("o").state, "indexing");

        c.set_progress("o", "sobjects", 3, 10);
        let s = c.status("o");
        assert_eq!(s.state, "indexing");
        assert_eq!(s.phase.as_deref(), Some("sobjects"));
        assert_eq!(s.done, Some(3));
        assert_eq!(s.total, Some(10));

        c.set_ready("o");
        let s = c.status("o");
        assert_eq!(s.state, "ready");
        assert!(s.phase.is_none());
        assert!(s.last_indexed.is_some());

        c.set_error("o", "boom".into());
        let s = c.status("o");
        assert_eq!(s.state, "error");
        assert_eq!(s.error.as_deref(), Some("boom"));
    }

    #[test]
    fn ready_org_is_fresh_but_error_org_is_not() {
        let c = coord();
        c.set_ready("o");
        assert!(c.is_fresh("o"));
        c.set_error("o", "x".into());
        assert!(!c.is_fresh("o"));
        assert!(!c.is_fresh("never"));
    }

    #[tokio::test]
    async fn single_flight_dedupes_sequential_calls_within_ttl() {
        let c = coord();
        let runs = AtomicUsize::new(0);
        let body = || async {
            runs.fetch_add(1, Ordering::SeqCst);
            Ok::<(), CommandError>(())
        };
        c.coordinate("o".into(), false, body).await.unwrap();
        // Second call within TTL joins the fresh result → body must not re-run.
        c.coordinate("o".into(), false, body).await.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn concurrent_calls_run_body_once() {
        let c = coord();
        let runs = AtomicUsize::new(0);
        let mk = || {
            let runs = &runs;
            move || async move {
                runs.fetch_add(1, Ordering::SeqCst);
                // Yield so both futures are in-flight against the gate.
                tokio::task::yield_now().await;
                Ok::<(), CommandError>(())
            }
        };
        let (a, b) = tokio::join!(
            c.coordinate("o".into(), false, mk()),
            c.coordinate("o".into(), false, mk()),
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn force_bypasses_freshness() {
        let c = coord();
        let runs = AtomicUsize::new(0);
        let body = || async {
            runs.fetch_add(1, Ordering::SeqCst);
            Ok::<(), CommandError>(())
        };
        c.coordinate("o".into(), false, body).await.unwrap();
        c.coordinate("o".into(), true, body).await.unwrap();
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn failed_run_records_error_and_propagates() {
        let c = coord();
        let r = c
            .coordinate("o".into(), false, || async {
                Err::<(), CommandError>(CommandError::new("cli", "nope"))
            })
            .await;
        assert!(r.is_err());
        assert_eq!(c.status("o").state, "error");
        assert!(!c.is_fresh("o"));
    }
}
