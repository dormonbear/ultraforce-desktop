use sf_core::SfError;

/// The error shape every `#[tauri::command]` rejects with: a stable
/// machine-readable `code` (error category) plus the human-readable `Display`
/// message. Serialized over IPC as `{ code, message }` and rendered by the
/// frontend's `formatIpcError`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        CommandError {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl From<SfError> for CommandError {
    fn from(e: SfError) -> Self {
        let code = match &e {
            SfError::NotFound | SfError::Spawn(_) => "cli",
            SfError::Timeout(_) => "timeout",
            SfError::Command { status, name, .. }
                if *status == 401 || name.eq_ignore_ascii_case("INVALID_SESSION_ID") =>
            {
                "auth"
            }
            SfError::Command { .. } => "command",
            SfError::Parse(_) => "parse",
            SfError::Unexpected(_) => "unexpected",
        };
        CommandError::new(code, e.to_string())
    }
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self {
        CommandError::new("io", e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sf_command_error_keeps_display_message() {
        let e = CommandError::from(SfError::Command {
            status: 1,
            name: "MALFORMED_QUERY".into(),
            message: "unexpected token: 'SE'".into(),
        });
        assert_eq!(e.code, "command");
        assert_eq!(
            e.message,
            "`sf` command failed (status 1): MALFORMED_QUERY: unexpected token: 'SE'"
        );
    }

    #[test]
    fn expired_session_classifies_as_auth() {
        let by_status = CommandError::from(SfError::Command {
            status: 401,
            name: "Unauthorized".into(),
            message: "expired".into(),
        });
        assert_eq!(by_status.code, "auth");
        let by_name = CommandError::from(SfError::Command {
            status: 1,
            name: "INVALID_SESSION_ID".into(),
            message: "expired".into(),
        });
        assert_eq!(by_name.code, "auth");
    }

    #[test]
    fn cli_missing_classifies_as_cli() {
        assert_eq!(CommandError::from(SfError::NotFound).code, "cli");
    }

    #[test]
    fn serializes_as_code_message_object() {
        let json = serde_json::to_value(CommandError::new("io", "boom")).unwrap();
        assert_eq!(json["code"], "io");
        assert_eq!(json["message"], "boom");
    }
}
