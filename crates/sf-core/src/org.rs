use crate::error::SfError;
use crate::SfInvoker;
use serde::Deserialize;

/// A usable org as reported by `sf org list`.
#[derive(Debug, Clone, Deserialize)]
pub struct OrgRef {
    pub username: String,
    #[serde(default)]
    pub alias: Option<String>,
    #[serde(rename = "instanceUrl", default)]
    pub instance_url: Option<String>,
    #[serde(rename = "isDefaultUsername", default)]
    pub is_default: bool,
    /// Org-type flags carried for free by `sf org list --json` (no extra network
    /// call). Absent → `false`, so a display can only ever assert a known type.
    #[serde(rename = "isSandbox", default)]
    pub is_sandbox: bool,
    #[serde(rename = "isScratch", default)]
    pub is_scratch: bool,
}

#[derive(Debug, Deserialize)]
struct OrgListResult {
    #[serde(rename = "nonScratchOrgs", default)]
    non_scratch: Vec<OrgRef>,
    #[serde(rename = "scratchOrgs", default)]
    scratch: Vec<OrgRef>,
    #[serde(default)]
    sandboxes: Vec<OrgRef>,
}

#[derive(Debug, Deserialize)]
struct OrgDisplay {
    #[serde(rename = "apiVersion", default)]
    api_version: Option<String>,
}

/// The bits needed to call the org's REST API directly: a live access token,
/// the instance host, and the API version. Host and version come from
/// `sf org display`; the token comes from `sf org auth show-access-token`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    #[serde(default)]
    pub access_token: String,
    pub instance_url: String,
    #[serde(default)]
    pub api_version: Option<String>,
}

/// `sf org auth show-access-token` output.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessToken {
    access_token: String,
}

/// Whether `org display` handed back a credential we can actually bear.
///
/// A Salesforce session id is a single opaque run of characters. The redaction
/// placeholder is a sentence, so whitespace alone separates the two — and it
/// also rejects an empty field, which older CLIs emit when not authenticated.
fn is_usable_token(token: &str) -> bool {
    !token.is_empty() && !token.chars().any(char::is_whitespace)
}

/// Discovery over `sf org list`.
pub struct OrgRegistry;

impl OrgRegistry {
    pub async fn list(invoker: &SfInvoker) -> Result<Vec<OrgRef>, SfError> {
        let r: OrgListResult = invoker.run_json(&["org", "list"]).await?;
        let mut all = r.non_scratch;
        all.extend(r.scratch);
        all.extend(r.sandboxes);
        // sf lists a sandbox under both `nonScratchOrgs` and `sandboxes`; dedupe
        // by username, keeping the first (non-scratch carries isDefaultUsername).
        let mut seen = std::collections::HashSet::new();
        all.retain(|o| seen.insert(o.username.clone()));
        Ok(all)
    }

    pub async fn default_org(invoker: &SfInvoker) -> Result<Option<OrgRef>, SfError> {
        Ok(Self::list(invoker)
            .await?
            .into_iter()
            .find(|o| o.is_default))
    }

    /// The org's API version via `sf org display`. `target` is a username/alias;
    /// pass `None` for the default org. `Ok(None)` if the field is absent.
    pub async fn api_version(
        invoker: &SfInvoker,
        target: Option<&str>,
    ) -> Result<Option<String>, SfError> {
        let mut args = vec!["org", "display"];
        if let Some(t) = target {
            args.push("--target-org");
            args.push(t);
        }
        let d: OrgDisplay = invoker.run_json(&args).await?;
        Ok(d.api_version)
    }

    /// The access token / instance URL / API version for `target` (or the default
    /// org when `None`), so callers can hit the REST API directly. `sf org
    /// display` returns a refreshed token.
    /// REST credentials for `target`.
    ///
    /// Newer `sf` releases redact the token out of `org display`, returning the
    /// literal sentence "[REDACTED] Use 'sf org auth show-access-token' to view".
    /// Sent as a bearer credential that earns an INVALID_AUTH_HEADER from the
    /// org, so the real token has to come from `org auth show-access-token`.
    ///
    /// The extra call is gated on what came back rather than on a CLI version:
    /// `MIN_SF_VERSION` is 2.0.0 and `show-access-token` is not present across
    /// that whole range, so an unconditional call would break older CLIs that
    /// still hand back a usable token inline. Those pay nothing here.
    pub async fn auth_info(
        invoker: &SfInvoker,
        target: Option<&str>,
    ) -> Result<AuthInfo, SfError> {
        let mut args = vec!["org", "display"];
        if let Some(t) = target {
            args.push("--target-org");
            args.push(t);
        }
        let mut info: AuthInfo = invoker.run_json(&args).await?;
        if is_usable_token(&info.access_token) {
            return Ok(info);
        }

        let mut token_args = vec!["org", "auth", "show-access-token"];
        if let Some(t) = target {
            token_args.push("--target-org");
            token_args.push(t);
        }
        let token: AccessToken = invoker.run_json(&token_args).await?;
        info.access_token = token.access_token;
        Ok(info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::MockRunner;
    use crate::SfInvoker;
    use std::sync::Arc;

    fn invoker_returning(stdout: &'static str) -> SfInvoker {
        SfInvoker::new(Arc::new(MockRunner::ok_json(stdout)))
    }

    #[tokio::test]
    async fn lists_orgs_across_categories() {
        let json = r#"{"status":0,"result":{
            "nonScratchOrgs":[{"username":"prod@x.com","alias":"prod","instanceUrl":"https://x.my.salesforce.com","isDefaultUsername":true}],
            "scratchOrgs":[{"username":"scratch@x.com"}],
            "sandboxes":[{"username":"sand@x.com","alias":"sand"}]
        }}"#;
        let orgs = OrgRegistry::list(&invoker_returning(json)).await.unwrap();
        assert_eq!(orgs.len(), 3);
        assert_eq!(orgs[0].username, "prod@x.com");
        assert_eq!(orgs[0].alias.as_deref(), Some("prod"));
        assert!(orgs[0].is_default);
        assert!(orgs[1].alias.is_none());
    }

    #[tokio::test]
    async fn dedupes_sandbox_listed_in_two_categories() {
        // sf reports a sandbox under both nonScratchOrgs and sandboxes.
        let json = r#"{"status":0,"result":{
            "nonScratchOrgs":[{"username":"sand@x.com","alias":"sand","isDefaultUsername":true}],
            "sandboxes":[{"username":"sand@x.com","alias":"sand"}]
        }}"#;
        let orgs = OrgRegistry::list(&invoker_returning(json)).await.unwrap();
        assert_eq!(orgs.len(), 1);
        assert!(orgs[0].is_default);
    }

    #[tokio::test]
    async fn finds_default_org() {
        let json = r#"{"status":0,"result":{
            "nonScratchOrgs":[
                {"username":"a@x.com","isDefaultUsername":false},
                {"username":"b@x.com","isDefaultUsername":true}
            ]
        }}"#;
        let def = OrgRegistry::default_org(&invoker_returning(json))
            .await
            .unwrap();
        assert_eq!(def.unwrap().username, "b@x.com");
    }

    /// `org display` redacts the token; only `org auth show-access-token` has a
    /// usable one. Regression guard: bearing the redaction sentence made every
    /// direct REST call fail with INVALID_AUTH_HEADER.
    #[tokio::test]
    async fn reads_auth_info_for_rest_calls() {
        let display = r#"{"status":0,"result":{
            "accessToken":"[REDACTED] Use 'sf org auth show-access-token' to view",
            "instanceUrl":"https://x.my.salesforce.com","apiVersion":"67.0"
        }}"#;
        let token = r#"{"status":0,"result":{"accessToken":"00D5j!AQEA"}}"#;
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
            let stdout = if args.iter().any(|a| a == "show-access-token") {
                token
            } else {
                display
            };
            Ok(crate::runner::RawOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            })
        })));

        let a = OrgRegistry::auth_info(&invoker, Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(a.access_token, "00D5j!AQEA");
        assert_eq!(a.instance_url, "https://x.my.salesforce.com");
        assert_eq!(a.api_version.as_deref(), Some("67.0"));
    }

    /// Older CLIs still inline a usable token. `show-access-token` may not
    /// exist that far back, so it must not be called at all.
    #[tokio::test]
    async fn auth_info_skips_second_call_when_token_is_inline() {
        let calls = Arc::new(std::sync::Mutex::new(0usize));
        let calls2 = calls.clone();
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
            *calls2.lock().unwrap() += 1;
            assert!(
                !args.iter().any(|a| a == "show-access-token"),
                "must not reach for show-access-token when the token is inline"
            );
            Ok(crate::runner::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"accessToken":"00D5j!AQEA","instanceUrl":"https://x"}}"#
                    .to_string(),
                stderr: String::new(),
            })
        })));

        let a = OrgRegistry::auth_info(&invoker, Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(a.access_token, "00D5j!AQEA");
        assert_eq!(*calls.lock().unwrap(), 1);
    }

    #[test]
    fn redaction_sentence_is_not_a_usable_token() {
        assert!(is_usable_token("00D5j!AQEAxyz"));
        assert!(!is_usable_token(
            "[REDACTED] Use 'sf org auth show-access-token' to view"
        ));
        assert!(!is_usable_token(""));
    }

    /// Both calls must carry the target org, or the token belongs to a
    /// different org than the host it is paired with.
    #[tokio::test]
    async fn auth_info_targets_the_same_org_on_both_calls() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::<Vec<String>>::new()));
        let seen2 = seen.clone();
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
            let redacted = args.iter().all(|a| a != "show-access-token");
            seen2.lock().unwrap().push(args.to_vec());
            let token = if redacted { "[REDACTED] Use it" } else { "00Dreal" };
            Ok(crate::runner::RawOutput {
                status: 0,
                stdout: format!(
                    r#"{{"status":0,"result":{{"accessToken":"{token}","instanceUrl":"https://x"}}}}"#
                ),
                stderr: String::new(),
            })
        })));

        OrgRegistry::auth_info(&invoker, Some("me@x.com"))
            .await
            .unwrap();
        let calls = seen.lock().unwrap().clone();
        assert_eq!(calls.len(), 2, "expected org display + show-access-token");
        for c in &calls {
            assert!(
                c.windows(2)
                    .any(|w| w[0] == "--target-org" && w[1] == "me@x.com"),
                "call missing target org: {c:?}"
            );
        }
    }

    #[tokio::test]
    async fn reads_api_version_from_org_display() {
        let json = r#"{"status":0,"result":{"apiVersion":"67.0"}}"#;
        let v = OrgRegistry::api_version(&invoker_returning(json), Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(v.as_deref(), Some("67.0"));
    }
}
