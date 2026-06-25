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
/// the instance host, and the API version. From `sf org display`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    pub access_token: String,
    pub instance_url: String,
    #[serde(default)]
    pub api_version: Option<String>,
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
    pub async fn auth_info(
        invoker: &SfInvoker,
        target: Option<&str>,
    ) -> Result<AuthInfo, SfError> {
        let mut args = vec!["org", "display"];
        if let Some(t) = target {
            args.push("--target-org");
            args.push(t);
        }
        invoker.run_json(&args).await
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

    #[tokio::test]
    async fn reads_auth_info_for_rest_calls() {
        let json = r#"{"status":0,"result":{
            "accessToken":"00D5j!AQEA","instanceUrl":"https://x.my.salesforce.com","apiVersion":"67.0"
        }}"#;
        let a = OrgRegistry::auth_info(&invoker_returning(json), Some("me@x.com"))
            .await
            .unwrap();
        assert_eq!(a.access_token, "00D5j!AQEA");
        assert_eq!(a.instance_url, "https://x.my.salesforce.com");
        assert_eq!(a.api_version.as_deref(), Some("67.0"));
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
