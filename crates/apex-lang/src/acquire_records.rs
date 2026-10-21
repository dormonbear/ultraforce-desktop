use serde::Deserialize;
use sf_core::{SfError, SfInvoker};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<T> {
    records: Vec<T>,
    done: Option<bool>,
    total_size: Option<usize>,
}

pub(super) async fn fetch<T: serde::de::DeserializeOwned>(
    invoker: &SfInvoker,
    args: &[&str],
    timeout: Option<Duration>,
) -> Result<Vec<T>, SfError> {
    let env: Envelope<T> = match timeout {
        Some(timeout) => invoker.run_json_with_timeout(args, timeout).await?,
        None => invoker.run_json(args).await?,
    };
    if env.done != Some(true) || env.total_size != Some(env.records.len()) {
        return Err(SfError::Spawn(std::io::Error::other(
            "Tooling query incomplete or missing completion proof; previous index retained — retry indexing or sync",
        )));
    }
    Ok(env.records)
}
