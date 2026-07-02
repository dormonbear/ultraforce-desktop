//! `sf` CLI health probing and web-login orchestration.

use crate::dto::SfStatusDto;
use crate::error::CommandError;
use crate::state::AppState;

/// Pure state decision. `meets_min` is `Some(true/false)` when `sf --version`
/// ran, `None` when the CLI wasn't on PATH; `probe_found` is whether a login
/// shell located `sf` anyway.
fn cli_state(meets_min: Option<bool>, probe_found: bool) -> &'static str {
    match meets_min {
        Some(true) => "ok",
        Some(false) => "outdated",
        None if probe_found => "path_issue",
        None => "not_found",
    }
}

/// Look for `sf` via the user's login shell (handles zsh/bash/fish rc files and
/// version managers the app's own PATH may miss). Returns its path if found.
/// Bounded by a short timeout so a slow shell rc can't hang the health check.
#[cfg(unix)]
async fn probe_sf_via_login_shell() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let fut = tokio::process::Command::new(shell)
        .args(["-ilc", "command -v sf"])
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(5), fut)
        .await
        .ok()?
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then_some(path)
}

#[cfg(not(unix))]
async fn probe_sf_via_login_shell() -> Option<String> {
    None
}

pub(crate) async fn sf_status(state: &AppState) -> Result<SfStatusDto, CommandError> {
    let min_version = sf_core::SfVersion::min_version_str();
    match sf_core::SfVersion::detect(&state.invoker).await {
        Ok(v) => Ok(SfStatusDto {
            state: cli_state(Some(v.meets_minimum()), false),
            version: Some(v.raw),
            min_version,
            found_at: None,
        }),
        // Not on PATH (or unparseable version) → see if it's installed elsewhere.
        Err(_) => {
            let found_at = probe_sf_via_login_shell().await;
            Ok(SfStatusDto {
                state: cli_state(None, found_at.is_some()),
                version: None,
                min_version,
                found_at,
            })
        }
    }
}

/// Build the `sf org login web` argv from the optional knobs. Pure, so the
/// arg mapping is unit-testable without spawning a process.
fn build_login_args(
    instance_url: Option<&str>,
    alias: Option<&str>,
    set_default: bool,
) -> Vec<String> {
    let mut a = vec!["org".to_string(), "login".to_string(), "web".to_string()];
    if let Some(u) = instance_url.filter(|s| !s.trim().is_empty()) {
        a.push("--instance-url".to_string());
        a.push(u.trim().to_string());
    }
    if let Some(al) = alias.filter(|s| !s.trim().is_empty()) {
        a.push("--alias".to_string());
        a.push(al.trim().to_string());
    }
    if set_default {
        a.push("--set-default".to_string());
    }
    a
}

/// Run `sf org login web` (opens the system browser for OAuth). Blocks until the
/// flow finishes, so it gets a generous timeout. `instance_url` selects a
/// sandbox / custom domain; `alias` / `set_default` are optional knobs.
pub(crate) async fn login_org(
    instance_url: Option<String>,
    alias: Option<String>,
    set_default: Option<bool>,
    state: &AppState,
) -> Result<(), CommandError> {
    let mut args = build_login_args(
        instance_url.as_deref(),
        alias.as_deref(),
        set_default.unwrap_or(true),
    );
    args.push("--json".to_string());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = state
        .invoker
        .run_raw_with_timeout(&arg_refs, std::time::Duration::from_secs(300))
        .await
        .map_err(CommandError::from)?;
    if out.status != 0 {
        let msg = out.stderr.trim();
        return Err(CommandError::new(
            "command",
            if msg.is_empty() {
                format!("`sf org login web` failed (status {})", out.status)
            } else {
                msg.to_string()
            },
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_login_args, cli_state};

    #[test]
    fn cli_state_classifies_each_case() {
        assert_eq!(cli_state(Some(true), false), "ok");
        assert_eq!(cli_state(Some(false), false), "outdated");
        assert_eq!(cli_state(None, true), "path_issue");
        assert_eq!(cli_state(None, false), "not_found");
        // A found version always wins, even if a probe would also find it.
        assert_eq!(cli_state(Some(true), true), "ok");
    }

    #[test]
    fn login_args_default_is_web_login_with_set_default() {
        assert_eq!(
            build_login_args(None, None, true),
            vec!["org", "login", "web", "--set-default"]
        );
    }

    #[test]
    fn login_args_include_instance_url_and_alias_when_present() {
        assert_eq!(
            build_login_args(Some("https://test.salesforce.com"), Some("sandbox"), false),
            vec![
                "org",
                "login",
                "web",
                "--instance-url",
                "https://test.salesforce.com",
                "--alias",
                "sandbox"
            ]
        );
    }

    #[test]
    fn login_args_skip_blank_knobs() {
        assert_eq!(
            build_login_args(Some("  "), Some(""), false),
            vec!["org", "login", "web"]
        );
    }
}
