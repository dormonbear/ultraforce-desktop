//! Single-record REST DML + a generic REST escape hatch. Same layer and auth
//! contract as `soql::run_query_rest`: caller supplies a fresh `AuthInfo`.

use sf_core::{AuthInfo, SfError};

fn base(auth: &AuthInfo) -> String {
    let api = auth.api_version.as_deref().unwrap_or("62.0");
    format!(
        "{}/services/data/v{api}",
        auth.instance_url.trim_end_matches('/')
    )
}

fn sobject_url(auth: &AuthInfo, object: &str, id: Option<&str>) -> String {
    match id {
        Some(id) => format!("{}/sobjects/{object}/{id}", base(auth)),
        None => format!("{}/sobjects/{object}", base(auth)),
    }
}

/// Salesforce REST errors arrive as `[{"message","errorCode"}]`; surface both.
fn map_rest_error(status: u16, body: &str) -> SfError {
    #[derive(serde::Deserialize)]
    struct RestErr {
        message: String,
        #[serde(rename = "errorCode")]
        error_code: String,
    }
    match serde_json::from_str::<Vec<RestErr>>(body) {
        Ok(errs) if !errs.is_empty() => SfError::Unexpected(
            errs.iter()
                .map(|e| format!("{}: {}", e.error_code, e.message))
                .collect::<Vec<_>>()
                .join("; "),
        ),
        _ => SfError::Unexpected(format!(
            "HTTP {status}: {}",
            body.chars().take(500).collect::<String>()
        )),
    }
}

async fn send(
    auth: &AuthInfo,
    method: reqwest::Method,
    url: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, String), SfError> {
    let client = reqwest::Client::new();
    let mut req = client
        .request(method, url)
        .bearer_auth(&auth.access_token)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(b);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| SfError::Unexpected(format!("request failed: {e}")))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| SfError::Unexpected(format!("read body failed: {e}")))?;
    Ok((status, text))
}

pub async fn record_get(
    auth: &AuthInfo,
    object: &str,
    id: &str,
) -> Result<serde_json::Value, SfError> {
    let (status, body) = send(
        auth,
        reqwest::Method::GET,
        &sobject_url(auth, object, Some(id)),
        None,
    )
    .await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    serde_json::from_str(&body).map_err(SfError::Parse)
}

pub async fn record_create(
    auth: &AuthInfo,
    object: &str,
    fields: &serde_json::Value,
) -> Result<String, SfError> {
    let (status, body) = send(
        auth,
        reqwest::Method::POST,
        &sobject_url(auth, object, None),
        Some(fields),
    )
    .await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    let v: serde_json::Value = serde_json::from_str(&body).map_err(SfError::Parse)?;
    v.get("id")
        .and_then(|i| i.as_str())
        .map(String::from)
        .ok_or_else(|| SfError::Unexpected(format!("create response missing id: {body}")))
}

pub async fn record_update(
    auth: &AuthInfo,
    object: &str,
    id: &str,
    fields: &serde_json::Value,
) -> Result<(), SfError> {
    let (status, body) = send(
        auth,
        reqwest::Method::PATCH,
        &sobject_url(auth, object, Some(id)),
        Some(fields),
    )
    .await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    Ok(())
}

pub async fn record_delete(auth: &AuthInfo, object: &str, id: &str) -> Result<(), SfError> {
    let (status, body) = send(
        auth,
        reqwest::Method::DELETE,
        &sobject_url(auth, object, Some(id)),
        None,
    )
    .await?;
    if status >= 300 {
        return Err(map_rest_error(status, &body));
    }
    Ok(())
}

/// Generic escape hatch. `path` must already start with `/services/` (the
/// caller validates); returns (status, parsed-or-string body).
pub async fn rest_request(
    auth: &AuthInfo,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
) -> Result<(u16, serde_json::Value), SfError> {
    let m: reqwest::Method = method
        .parse()
        .map_err(|_| SfError::Unexpected(format!("bad method {method}")))?;
    let url = format!("{}{}", auth.instance_url.trim_end_matches('/'), path);
    let (status, text) = send(auth, m, &url, body).await?;
    let parsed = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::Value::String(text.chars().take(20_000).collect()));
    Ok((status, parsed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_salesforce_error_array() {
        // Salesforce REST errors are a JSON array of {message, errorCode}
        let e = map_rest_error(400, r#"[{"message":"No such column 'Foo'","errorCode":"INVALID_FIELD"}]"#);
        let msg = e.to_string();
        assert!(msg.contains("INVALID_FIELD") && msg.contains("No such column"), "{msg}");
    }

    #[test]
    fn maps_non_json_error_body() {
        let e = map_rest_error(502, "<html>Bad Gateway</html>");
        assert!(e.to_string().contains("502"));
    }

    #[test]
    fn builds_sobject_url() {
        let auth = sf_core::AuthInfo {
            access_token: "t".into(),
            instance_url: "https://x.my.salesforce.com/".into(),
            api_version: Some("62.0".into()),
        };
        assert_eq!(
            sobject_url(&auth, "Account", Some("001xx")),
            "https://x.my.salesforce.com/services/data/v62.0/sobjects/Account/001xx"
        );
        assert_eq!(
            sobject_url(&auth, "Account", None),
            "https://x.my.salesforce.com/services/data/v62.0/sobjects/Account"
        );
    }
}
