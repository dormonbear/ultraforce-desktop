//! Process-level startup: tracing/log-file initialization plus the macOS
//! GUI-launch workarounds (login-shell PATH, file-based `sf` keystore).

use tracing_subscriber::EnvFilter;

/// ponytail: GUI apps launched from Finder/Dock inherit launchd's minimal PATH,
/// not the shell PATH — so `sf` installed via mise/nvm/brew is invisible and
/// every `sf` call fails with `NotFound`. Pull the login shell's PATH once at
/// startup and adopt it. macOS-only; other platforms inherit a usable PATH.
///
/// Probing spawns an *interactive login* shell (rc files, mise/nvm init), which
/// costs 200ms-2s and used to block window creation. So: adopt the cached PATH
/// immediately and re-probe on a background thread, which lands on next launch.
#[cfg(target_os = "macos")]
pub(crate) fn inherit_login_path() {
    let cache = path_cache_file();
    if let Some(cached) = cache.as_deref().and_then(read_cached_path) {
        std::env::set_var("PATH", cached);
        std::thread::spawn(move || {
            if let (Some(file), Some(path)) = (cache, probe_login_path()) {
                write_cached_path(&file, &path);
            }
        });
        return;
    }
    let Some(path) = probe_login_path() else { return };
    std::env::set_var("PATH", &path);
    if let Some(file) = cache {
        write_cached_path(&file, &path);
    }
}

#[cfg(target_os = "macos")]
fn probe_login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let out = std::process::Command::new(&shell)
        .args(["-ilc", "echo $PATH"])
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[cfg(target_os = "macos")]
fn path_cache_file() -> Option<std::path::PathBuf> {
    Some(dirs::data_dir()?.join("ultraforce").join("path-cache"))
}

fn read_cached_path(file: &std::path::Path) -> Option<String> {
    let path = std::fs::read_to_string(file).ok()?;
    let path = path.trim().to_string();
    (!path.is_empty()).then_some(path)
}

fn write_cached_path(file: &std::path::Path, path: &str) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, path);
}

/// The `~/.sfdx/key.json` body `sf` reads when `SF_USE_GENERIC_UNIX_KEYCHAIN` is
/// set. Pure, so the exact shape `@salesforce/core` expects is unit-testable.
/// `key` is a hex string `sf` generated, so no JSON escaping is needed.
fn key_json(key: &str) -> String {
    format!("{{\n  \"account\": \"local\",\n  \"key\": \"{key}\",\n  \"service\": \"sfdx\"\n}}")
}

/// ponytail: a GUI-launched subprocess can't always reach the macOS login
/// keychain (locked, fresh/corporate account, missing keychain) — `sf` then
/// fails OAuth with "A keychain cannot be found to store". Force `sf` to keep
/// its crypto key in a file (`~/.sfdx/key.json`) instead of the OS keychain. To
/// stay compatible with orgs already authed via the OS keychain, seed that file
/// once from the existing keychain key if one is present.
#[cfg(target_os = "macos")]
pub(crate) fn use_file_keystore() {
    use std::os::unix::fs::PermissionsExt;
    std::env::set_var("SF_USE_GENERIC_UNIX_KEYCHAIN", "true");
    let Some(home) = dirs::home_dir() else { return };
    // `sf`'s file keystore lives at `Global.DIR/key.json` = `~/.sfdx/key.json`.
    let key_file = home.join(".sfdx").join("key.json");
    if key_file.exists() {
        return;
    }
    // Migrate the existing key from the OS keychain if there is one; otherwise
    // leave it and `sf` will create `key.json` itself on the first login.
    let Ok(out) = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-a", "local", "-s", "sfdx", "-w"])
        .output()
    else {
        return;
    };
    let key = String::from_utf8_lossy(&out.stdout);
    let key = key.trim();
    if !out.status.success() || key.is_empty() {
        return;
    }
    if std::fs::create_dir_all(key_file.parent().unwrap()).is_ok()
        && std::fs::write(&key_file, key_json(key)).is_ok()
    {
        let _ = std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600));
    }
}

pub(crate) fn init_tracing() -> tracing_appender::non_blocking::WorkerGuard {
    let log_dir = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ultraforce")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let file_appender = tracing_appender::rolling::daily(log_dir, "ultraforce.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let filter = std::env::var("ULTRAFORCE_LOG")
        .ok()
        .and_then(|value| EnvFilter::try_new(value).ok())
        .unwrap_or_else(|| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .init();
    guard
}

#[cfg(test)]
mod tests {
    use super::{key_json, read_cached_path, write_cached_path};

    #[test]
    fn path_cache_round_trips_and_rejects_blanks() {
        let file = std::env::temp_dir()
            .join("ultraforce-test")
            .join("path-cache");
        write_cached_path(&file, "/usr/local/bin:/usr/bin");
        assert_eq!(read_cached_path(&file).as_deref(), Some("/usr/local/bin:/usr/bin"));
        write_cached_path(&file, "  \n ");
        assert_eq!(read_cached_path(&file), None);
        let _ = std::fs::remove_file(&file);
        assert_eq!(read_cached_path(&file), None);
    }

    #[test]
    fn key_json_matches_sf_generic_keystore_shape() {
        let v: serde_json::Value = serde_json::from_str(&key_json("deadbeef")).unwrap();
        assert_eq!(v["account"], "local");
        assert_eq!(v["service"], "sfdx");
        assert_eq!(v["key"], "deadbeef");
    }
}
