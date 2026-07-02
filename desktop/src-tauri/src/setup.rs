//! Process-level startup: tracing/log-file initialization plus the macOS
//! GUI-launch workarounds (login-shell PATH, file-based `sf` keystore).

use tracing_subscriber::EnvFilter;

/// ponytail: GUI apps launched from Finder/Dock inherit launchd's minimal PATH,
/// not the shell PATH — so `sf` installed via mise/nvm/brew is invisible and
/// every `sf` call fails with `NotFound`. Pull the login shell's PATH once at
/// startup and adopt it. macOS-only; other platforms inherit a usable PATH.
#[cfg(target_os = "macos")]
pub(crate) fn inherit_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(out) = std::process::Command::new(&shell)
        .args(["-ilc", "echo $PATH"])
        .output()
    {
        let path = String::from_utf8_lossy(&out.stdout);
        let path = path.trim();
        if !path.is_empty() {
            std::env::set_var("PATH", path);
        }
    }
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
    use super::key_json;

    #[test]
    fn key_json_matches_sf_generic_keystore_shape() {
        let v: serde_json::Value = serde_json::from_str(&key_json("deadbeef")).unwrap();
        assert_eq!(v["account"], "local");
        assert_eq!(v["service"], "sfdx");
        assert_eq!(v["key"], "deadbeef");
    }
}
