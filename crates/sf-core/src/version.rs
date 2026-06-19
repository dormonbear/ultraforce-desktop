use crate::error::SfError;
use crate::SfInvoker;
use semver::Version;

/// Minimum supported `sf` major.minor.patch.
const MIN_SF_VERSION: (u64, u64, u64) = (2, 0, 0);

/// Detected `sf` CLI version and the minimum-version gate.
pub struct SfVersion {
    pub version: Version,
    pub raw: String,
}

impl SfVersion {
    /// Extract the semver token from `sf --version` plain-text output,
    /// e.g. "@salesforce/cli/2.127.2 darwin-arm64 node-v22.21.1".
    pub fn parse(output: &str) -> Result<Version, SfError> {
        let token = output.split_whitespace().next().unwrap_or("");
        let ver = token.rsplit('/').next().unwrap_or("");
        Version::parse(ver)
            .map_err(|_| SfError::Unexpected(format!("cannot parse sf version from {output:?}")))
    }

    pub async fn detect(invoker: &SfInvoker) -> Result<SfVersion, SfError> {
        let out = invoker.run_raw(&["--version"]).await?;
        let version = Self::parse(&out.stdout)?;
        Ok(SfVersion {
            version,
            raw: out.stdout.trim().to_string(),
        })
    }

    pub fn meets_minimum(&self) -> bool {
        (self.version.major, self.version.minor, self.version.patch) >= MIN_SF_VERSION
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::MockRunner;
    use crate::SfInvoker;
    use semver::Version;
    use std::sync::Arc;

    #[test]
    fn parses_version_token_from_sf_output() {
        let v = SfVersion::parse("@salesforce/cli/2.127.2 darwin-arm64 node-v22.21.1").unwrap();
        assert_eq!(v, Version::new(2, 127, 2));
    }

    #[test]
    fn rejects_unparseable_output() {
        assert!(SfVersion::parse("garbage output").is_err());
    }

    #[test]
    fn meets_minimum_compares_correctly() {
        let ok = SfVersion {
            version: Version::new(2, 127, 2),
            raw: String::new(),
        };
        assert!(ok.meets_minimum());
        let old = SfVersion {
            version: Version::new(1, 99, 0),
            raw: String::new(),
        };
        assert!(!old.meets_minimum());
    }

    #[tokio::test]
    async fn detect_reads_raw_version_output() {
        let runner = MockRunner::ok_json("@salesforce/cli/2.127.2 darwin-arm64 node-v22.21.1\n");
        let invoker = SfInvoker::new(Arc::new(runner));
        let v = SfVersion::detect(&invoker).await.unwrap();
        assert_eq!(v.version, Version::new(2, 127, 2));
        assert!(v.meets_minimum());
    }
}
