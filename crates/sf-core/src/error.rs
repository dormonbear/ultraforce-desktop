use std::time::Duration;
use thiserror::Error;

/// All failure modes when orchestrating the `sf` CLI.
#[derive(Debug, Error)]
pub enum SfError {
    #[error("`sf` CLI not found on PATH; install the Salesforce CLI")]
    NotFound,
    #[error("failed to spawn `sf`: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("`sf` timed out after {0:?}")]
    Timeout(Duration),
    #[error("`sf` command failed (status {status}): {name}: {message}")]
    Command { status: i32, name: String, message: String },
    #[error("failed to parse `sf` JSON output: {0}")]
    Parse(#[source] serde_json::Error),
    #[error("unexpected `sf` output: {0}")]
    Unexpected(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_has_actionable_message() {
        let msg = SfError::NotFound.to_string();
        assert!(msg.contains("not found"), "got: {msg}");
        assert!(msg.contains("Salesforce CLI"), "got: {msg}");
    }

    #[test]
    fn command_error_includes_status_and_name() {
        let e = SfError::Command { status: 1, name: "NoOrgFound".into(), message: "no org".into() };
        let msg = e.to_string();
        assert!(msg.contains("status 1"), "got: {msg}");
        assert!(msg.contains("NoOrgFound"), "got: {msg}");
    }
}
