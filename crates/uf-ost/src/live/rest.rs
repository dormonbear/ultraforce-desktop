//! Generic REST escape hatch — so an uncovered API never forces the agent
//! back to curl/CLI. Writes go through the same prod gate as DML.

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestDto {
    pub org: String,
    pub status: u16,
    pub body: serde_json::Value,
}

/// Path must live under /services/ (REST, Tooling, Composite, Bulk); method
/// whitelist; returns whether this counts as a write (⇒ prod gate applies).
pub fn check_path_and_method(path: &str, method: &str) -> Result<bool, ErrorData> {
    if !path.starts_with("/services/") {
        return Err(ErrorData::invalid_params(
            format!("path must start with /services/ — got '{path}'"),
            None,
        ));
    }
    match method {
        "GET" => Ok(false),
        "POST" | "PATCH" | "PUT" | "DELETE" => Ok(true),
        other => Err(ErrorData::invalid_params(
            format!("unsupported method '{other}' (GET/POST/PATCH/PUT/DELETE)"),
            None,
        )),
    }
}

pub async fn rest(
    live: &LiveCtx,
    org: &str,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    confirm: bool,
) -> Result<RestDto, ErrorData> {
    let is_write = check_path_and_method(path, method)?;
    if is_write {
        gate_write(live.is_prod(org).await, confirm)?;
    }
    let auth = live.auth(org).await?;
    let (status, parsed) = features::rest_dml::rest_request(&auth, method, path, body)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(RestDto {
        org: org.to_string(),
        status,
        body: parsed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_path_and_classifies_writes() {
        assert_eq!(
            check_path_and_method("/services/data/v62.0/limits", "GET").unwrap(),
            false
        );
        assert_eq!(
            check_path_and_method("/services/data/v62.0/sobjects/Account", "POST").unwrap(),
            true
        );
        assert_eq!(
            check_path_and_method("/services/data/v62.0/x", "PATCH").unwrap(),
            true
        );
        assert_eq!(
            check_path_and_method("/services/data/v62.0/x", "DELETE").unwrap(),
            true
        );
        // non-/services/ path refused
        assert!(check_path_and_method("/secur/frontdoor.jsp", "GET").is_err());
        // unknown method refused
        assert!(check_path_and_method("/services/data/v62.0/x", "TRACE").is_err());
    }
}
