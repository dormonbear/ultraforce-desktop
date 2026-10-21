use serde::Deserialize;
use serde_json::Value;
use sf_core::{SfError, SfInvoker};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    records: Vec<Value>,
    done: Option<bool>,
    total_size: Option<usize>,
}

pub(super) async fn fetch(
    invoker: &SfInvoker,
    args: &[&str],
    timeout: Option<Duration>,
) -> Result<Vec<Value>, SfError> {
    let env: Envelope = match timeout {
        Some(timeout) => invoker.run_json_with_timeout(args, timeout).await?,
        None => invoker.run_json(args).await?,
    };
    if env.done == Some(false) || env.total_size.is_some_and(|n| n != env.records.len()) {
        return Err(SfError::Spawn(std::io::Error::other(
            "Apex source query incomplete; previous index retained",
        )));
    }
    Ok(env.records)
}
