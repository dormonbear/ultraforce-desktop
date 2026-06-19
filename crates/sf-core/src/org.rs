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

/// Discovery over `sf org list`.
pub struct OrgRegistry;

impl OrgRegistry {
    pub async fn list(invoker: &SfInvoker) -> Result<Vec<OrgRef>, SfError> {
        let r: OrgListResult = invoker.run_json(&["org", "list"]).await?;
        let mut all = r.non_scratch;
        all.extend(r.scratch);
        all.extend(r.sandboxes);
        Ok(all)
    }

    pub async fn default_org(invoker: &SfInvoker) -> Result<Option<OrgRef>, SfError> {
        Ok(Self::list(invoker)
            .await?
            .into_iter()
            .find(|o| o.is_default))
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
}
