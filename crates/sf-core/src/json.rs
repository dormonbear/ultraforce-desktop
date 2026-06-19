use crate::error::SfError;
use serde::de::DeserializeOwned;
use serde::Deserialize;

/// The standard envelope every `sf --json` command emits.
#[derive(Debug, Deserialize)]
pub struct SfEnvelope<T> {
    pub status: i32,
    #[serde(default = "Option::default")]
    pub result: Option<T>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// Parse `sf --json` stdout into `T`, mapping non-zero status to `SfError::Command`.
pub fn parse_envelope<T: DeserializeOwned>(stdout: &str) -> Result<T, SfError> {
    let env: SfEnvelope<T> = serde_json::from_str(stdout).map_err(SfError::Parse)?;
    if env.status != 0 {
        return Err(SfError::Command {
            status: env.status,
            name: env.name.unwrap_or_else(|| "Error".to_string()),
            message: env.message.unwrap_or_default(),
        });
    }
    env.result
        .ok_or_else(|| SfError::Unexpected("missing `result` field".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Demo {
        a: i32,
    }

    #[test]
    fn parses_success_result() {
        let json = r#"{"status":0,"result":{"a":1},"warnings":[]}"#;
        let demo: Demo = parse_envelope(json).unwrap();
        assert_eq!(demo, Demo { a: 1 });
    }

    #[test]
    fn maps_nonzero_status_to_command_error() {
        let json = r#"{"status":1,"name":"NoOrgFound","message":"no default org"}"#;
        let err = parse_envelope::<Demo>(json).unwrap_err();
        match err {
            SfError::Command {
                status,
                name,
                message,
            } => {
                assert_eq!(status, 1);
                assert_eq!(name, "NoOrgFound");
                assert_eq!(message, "no default org");
            }
            other => panic!("expected Command, got {other:?}"),
        }
    }

    #[test]
    fn missing_result_on_success_is_unexpected() {
        let json = r#"{"status":0}"#;
        let err = parse_envelope::<Demo>(json).unwrap_err();
        assert!(matches!(err, SfError::Unexpected(_)), "got: {err:?}");
    }

    #[test]
    fn malformed_json_is_parse_error() {
        let err = parse_envelope::<Demo>("not json").unwrap_err();
        assert!(matches!(err, SfError::Parse(_)), "got: {err:?}");
    }
}
