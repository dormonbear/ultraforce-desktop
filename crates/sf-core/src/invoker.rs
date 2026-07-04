use crate::error::SfError;
use crate::json::parse_envelope;
use crate::runner::{CommandRunner, RawOutput};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// Runs `sf` subcommands through an injectable `CommandRunner`.
#[derive(Clone)]
pub struct SfInvoker {
    runner: Arc<dyn CommandRunner>,
    timeout: Duration,
}

impl SfInvoker {
    pub fn new(runner: Arc<dyn CommandRunner>) -> Self {
        Self {
            runner,
            timeout: DEFAULT_TIMEOUT,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Run `sf <args> --json` and parse the envelope into `T`.
    pub async fn run_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T, SfError> {
        let mut full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        if !full.iter().any(|a| a == "--json") {
            full.push("--json".to_string());
        }
        let out = self.runner.run("sf", &full, self.timeout).await?;
        parse_envelope(&out.stdout)
    }

    /// Like [`run_json`], but with a per-call timeout — for the rare known-slow
    /// JSON query (e.g. the full `ApexClass SymbolTable` pull, ~145 s on a large
    /// managed org) that legitimately exceeds the default bound.
    pub async fn run_json_with_timeout<T: DeserializeOwned>(
        &self,
        args: &[&str],
        timeout: Duration,
    ) -> Result<T, SfError> {
        let mut full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        if !full.iter().any(|a| a == "--json") {
            full.push("--json".to_string());
        }
        let out = self.runner.run("sf", &full, timeout).await?;
        parse_envelope(&out.stdout)
    }

    /// Run `sf <args>` and return raw output (for non-JSON commands like `--version`).
    pub async fn run_raw(&self, args: &[&str]) -> Result<RawOutput, SfError> {
        let full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        self.runner.run("sf", &full, self.timeout).await
    }

    /// Like [`run_raw`], but with a per-call timeout — for the rare known-slow
    /// call (e.g. the multi-megabyte Tooling completions payload) that
    /// legitimately exceeds the default bound.
    pub async fn run_raw_with_timeout(
        &self,
        args: &[&str],
        timeout: Duration,
    ) -> Result<RawOutput, SfError> {
        let full: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        self.runner.run("sf", &full, timeout).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::MockRunner;
    use serde::Deserialize;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Deserialize, PartialEq)]
    struct Demo {
        a: i32,
    }

    #[tokio::test]
    async fn run_json_appends_json_flag_and_parses_result() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            *seen2.lock().unwrap() = args.to_vec();
            Ok(crate::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"a":7}}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let demo: Demo = invoker.run_json(&["data", "query"]).await.unwrap();
        assert_eq!(demo, Demo { a: 7 });
        let args = seen.lock().unwrap().clone();
        assert_eq!(args, vec!["data", "query", "--json"]);
    }

    #[tokio::test]
    async fn run_json_does_not_duplicate_existing_json_flag() {
        let runner = MockRunner::new(move |_, args| {
            assert_eq!(args.iter().filter(|a| *a == "--json").count(), 1);
            Ok(crate::RawOutput {
                status: 0,
                stdout: r#"{"status":0,"result":{"a":1}}"#.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let _: Demo = invoker
            .run_json(&["data", "query", "--json"])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn run_raw_returns_stdout_unparsed() {
        let runner = MockRunner::ok_json("@salesforce/cli/2.127.2 darwin-arm64");
        let invoker = SfInvoker::new(Arc::new(runner));
        let out = invoker.run_raw(&["--version"]).await.unwrap();
        assert!(out.stdout.contains("2.127.2"));
    }
}
