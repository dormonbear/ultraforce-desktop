//! Desktop telemetry emission. STRICT privacy contract, same as the uf-ost sink
//! (`features::aptabase`): the `props` object carries ONLY {outcome, durationMs,
//! errorCategory?} — never org names/aliases, SOQL/Apex, record values or Ids,
//! tokens, or raw error text. `errorCategory` is `CommandError::code`, which is
//! a fixed set of `&'static` labels assigned at construction ("auth", "timeout",
//! "command", …) and never derived from a message. The POST is fire-and-forget.
//!
//! `telemetry.json` is the single source of truth, shared with the uf-ost binary
//! that reads the same cache root. Dev builds SEED it on first run (see
//! `seed_dev_default`) rather than keeping an in-memory default: two sources of
//! truth would let the settings toggle and the actual behaviour disagree.

use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use features::aptabase::{self, AptabaseClient};
use features::telemetry_config::{self, TelemetryConfig};

use crate::error::CommandError;

fn root() -> std::path::PathBuf {
    features::apex_complete::default_index_root()
}

/// Give dev builds telemetry by default, release builds opt-in, by writing the
/// choice once when the user has none. Keyed on the file EXISTING, not on it
/// parsing: a corrupt or half-written config must fail closed (`load` yields
/// both-false) instead of being re-seeded back on.
///
/// Note this also opts in the uf-ost binary reading the same file — deliberate,
/// and only ever on a machine that has run a dev build.
pub(crate) fn seed_dev_default(root: &Path, is_dev: bool) -> bool {
    if !is_dev || telemetry_config::config_path(root).exists() {
        return false;
    }
    let seeded = telemetry_config::save(
        root,
        &TelemetryConfig {
            // uf-ost owns the local sink; leave it to the user.
            local_enabled: false,
            remote_enabled: true,
        },
    )
    .is_ok();
    DEV_SEEDED.store(seeded, Ordering::Relaxed);
    seeded
}

static DEV_SEEDED: AtomicBool = AtomicBool::new(false);

/// Did this launch switch telemetry on by itself? The settings panel discloses
/// that, and cannot work it out alone: `import.meta.env.DEV` tracks Vite's build,
/// not `cfg!(debug_assertions)` — `tauri build --debug` seeds while shipping a
/// production frontend bundle.
pub(crate) fn dev_seeded() -> bool {
    DEV_SEEDED.load(Ordering::Relaxed)
}

const UNSET: u8 = 0;
const ON: u8 = 1;
const OFF: u8 = 2;
static REMOTE: AtomicU8 = AtomicU8::new(UNSET);

/// Current consent, read from disk once then cached. Cached — not baked into the
/// client — so that turning telemetry off takes effect on the next event rather
/// than the next launch.
fn remote_enabled() -> bool {
    match REMOTE.load(Ordering::Relaxed) {
        ON => true,
        OFF => false,
        _ => {
            seed_consent(telemetry_config::load(&root()).remote_enabled)
        }
    }
}

/// Record what the disk said, unless a real choice landed while we were reading
/// it. compare_exchange, not store: the read is slow enough for the user to opt
/// out meanwhile, and a plain store would put the stale value back. First writer
/// wins, so an explicit choice always beats this lazy seed.
fn seed_consent(disk_on: bool) -> bool {
    let seen = if disk_on { ON } else { OFF };
    match REMOTE.compare_exchange(UNSET, seen, Ordering::Relaxed, Ordering::Relaxed) {
        Ok(_) => seen == ON,
        Err(actual) => actual == ON,
    }
}

/// Point the cache at the user's new choice. Called by `set_telemetry_config`
/// right after the write lands.
pub(crate) fn set_remote_enabled(on: bool) {
    REMOTE.store(if on { ON } else { OFF }, Ordering::Relaxed);
}

/// The transport, built once. Consent is checked per event by `track`, not here.
fn client() -> Option<&'static AptabaseClient> {
    // Tests must never emit, whatever the developer's real config says.
    if cfg!(test) {
        return None;
    }
    static CLIENT: OnceLock<Option<AptabaseClient>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            aptabase::new(
                &aptabase::gen_session_id(),
                env!("CARGO_PKG_VERSION"),
                concat!("ultraforce-desktop@", env!("CARGO_PKG_VERSION")),
            )
        })
        .as_ref()
}

/// Time a command and report its outcome. Returns the command's own result
/// untouched — telemetry can never fail or alter it.
pub(crate) async fn track<T, F>(name: &'static str, f: F) -> Result<T, CommandError>
where
    F: Future<Output = Result<T, CommandError>>,
{
    if !remote_enabled() {
        return f.await;
    }
    let Some(ap) = client() else { return f.await };
    let started = Instant::now();
    let result = f.await;
    let ms = started.elapsed().as_millis() as u64;
    // Re-check: a reindex or a slow query can outlive the consent it started
    // under, and an opt-out must win over an event already in flight.
    if !remote_enabled() {
        return result;
    }
    match &result {
        Ok(_) => ap.track(name, "ok", ms, None, None),
        // `code`, never `message`: the message can carry SOQL, org names, or
        // record values.
        Err(e) => ap.track(name, "error", ms, Some(&e.code), None),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("uf-tel-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn dev_seeds_remote_on_and_leaves_the_uf_ost_local_sink_alone() {
        let d = tmp("dev");
        assert!(seed_dev_default(&d, true));
        let c = telemetry_config::load(&d);
        assert!(c.remote_enabled && !c.local_enabled);
        assert!(dev_seeded(), "the settings panel must be able to disclose this");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn release_never_seeds() {
        let d = tmp("rel");
        assert!(!seed_dev_default(&d, false));
        assert!(!telemetry_config::config_path(&d).exists());
        assert!(!telemetry_config::load(&d).remote_enabled);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn an_explicit_opt_out_is_never_re_seeded_on() {
        let d = tmp("optout");
        telemetry_config::save(
            &d,
            &TelemetryConfig { local_enabled: false, remote_enabled: false },
        )
        .unwrap();
        assert!(!seed_dev_default(&d, true));
        assert!(!telemetry_config::load(&d).remote_enabled);
        std::fs::remove_dir_all(&d).ok();
    }

    /// A corrupt config must fail closed — re-seeding it would silently turn
    /// reporting back on for someone who had switched it off.
    #[test]
    fn a_corrupt_config_fails_closed_rather_than_re_seeding() {
        let d = tmp("corrupt");
        std::fs::write(telemetry_config::config_path(&d), "{ truncated").unwrap();
        assert!(!seed_dev_default(&d, true));
        assert!(!telemetry_config::load(&d).remote_enabled);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn opting_out_takes_effect_without_a_restart() {
        set_remote_enabled(true);
        assert!(remote_enabled());
        set_remote_enabled(false);
        assert!(!remote_enabled(), "consent must not be cached past a change");
        REMOTE.store(UNSET, Ordering::Relaxed);
    }

    /// The lazy seed must never resurrect telemetry for someone who opted out
    /// while it was reading the file. Drives `seed_consent` directly: going
    /// through `remote_enabled` would short-circuit before the compare_exchange
    /// and pass even against a plain store.
    #[test]
    fn a_concurrent_opt_out_beats_the_lazy_seed() {
        REMOTE.store(UNSET, Ordering::Relaxed);
        set_remote_enabled(false);
        // Disk says on, but the explicit opt-out already landed and must win.
        assert!(!seed_consent(true));
        assert!(!remote_enabled());
        // With no competing choice, the disk value is what takes hold.
        REMOTE.store(UNSET, Ordering::Relaxed);
        assert!(seed_consent(true));
        REMOTE.store(UNSET, Ordering::Relaxed);
    }

    #[test]
    fn tests_never_emit_whatever_the_config_says() {
        assert!(client().is_none());
    }

    #[tokio::test]
    async fn track_returns_the_command_result_untouched() {
        let ok = track("t", async { Ok::<_, CommandError>(7) }).await;
        assert_eq!(ok.unwrap(), 7);
        let err = track("t", async {
            Err::<u8, _>(CommandError::new("auth", "expired session for acme.com"))
        })
        .await;
        assert_eq!(err.unwrap_err().code, "auth");
    }
}
