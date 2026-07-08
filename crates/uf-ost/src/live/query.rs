//! Live SOQL: offline pre-validation (block only definite errors), REST
//! execution with a row cap via the paginator's cancel flag, table-shaped DTO.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::LiveCtx;
use crate::query as ost_query;
use crate::soql::{self, Verdict};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SoqlResultDto {
    pub org: String,
    pub total_size: u64,
    pub returned: usize,
    pub done: bool,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub warning: Option<String>,
}

/// Block ONLY when the index positively knows the object and found errors.
pub fn validation_block(v: &Verdict) -> Option<String> {
    if !v.object_known || v.errors.is_empty() {
        return None;
    }
    let lines: Vec<String> = v.errors.iter().map(|(c, m)| format!("col {c}: {m}")).collect();
    Some(format!(
        "Offline validation failed (query NOT sent to the org):\n{}\n\
         If a field was added recently, run ost_sync first; to force execution pass skipValidation: true.",
        lines.join("\n")
    ))
}

fn shape(qr: &features::soql::QueryResult, org: &str, limit: usize) -> SoqlResultDto {
    let table = qr.to_table();
    // A single REST page can return up to 2000 rows with done=true — the cancel
    // flag only stops pagination BETWEEN pages, so an in-page overflow must also
    // count as truncation.
    let truncated = !qr.done || table.rows.len() > limit;
    let returned = table.rows.len().min(limit);
    SoqlResultDto {
        org: org.to_string(),
        total_size: qr.total_size,
        returned,
        done: !truncated,
        columns: table.columns,
        rows: table.rows.into_iter().take(limit).collect(),
        warning: truncated.then(|| {
            format!(
                "Truncated at {limit} rows (totalSize={}). Refine the query (WHERE/LIMIT) or raise `limit`.",
                qr.total_size
            )
        }),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn soql_query(
    root: &Path,
    live: &LiveCtx,
    org: &str,
    query: &str,
    tooling: bool,
    all_rows: bool,
    limit: usize,
    skip_validation: bool,
) -> Result<SoqlResultDto, ErrorData> {
    // 1. Offline pre-validation — free, local, blocks only definite errors.
    //    Tooling-API queries validate against Tooling objects we don't index ⇒ skip.
    if !skip_validation && !tooling {
        if let Ok(snap) = ost_query::open_org(root, org) {
            if let Ok(v) = soql::verdict(&snap, query) {
                if let Some(msg) = validation_block(&v) {
                    return Err(ErrorData::invalid_params(msg, None));
                }
            }
        } // unindexed org ⇒ pass through
    }

    // 2. Execute over REST with a row cap: flip the paginator's cancel flag
    //    once enough rows arrived (partial result comes back with done=false).
    let auth = live.auth(org).await?;
    let cancel = AtomicBool::new(false);
    let cap = limit as u64;
    let opts = features::soql::QueryOptions { use_tooling_api: tooling, all_rows };
    let res = features::soql::run_query_rest(
        &auth,
        query,
        opts,
        &|fetched, _| {
            if fetched >= cap {
                cancel.store(true, Ordering::Relaxed);
            }
        },
        &cancel,
    )
    .await;

    match res {
        Ok(qr) => Ok(shape(&qr, org, limit)),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("INVALID_SESSION_ID") {
                live.drop_auth(org).await;
            }
            // 3. Error enrichment: attach offline suggestions when the org
            //    rejected a field/column (agent skipped or beat validation).
            let hint = if msg.contains("INVALID_FIELD") || msg.contains("No such column") {
                "\nHint: use ost_object / ost_search to find the right field name."
            } else {
                ""
            };
            Err(ErrorData::invalid_params(format!("{msg}{hint}"), None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soql::Verdict;

    #[test]
    fn blocks_only_definite_errors() {
        // unknown object ⇒ pass through (index may be stale / org unindexed)
        assert!(validation_block(&Verdict { object_known: false, errors: vec![] }).is_none());
        // known object, no errors ⇒ pass
        assert!(validation_block(&Verdict { object_known: true, errors: vec![] }).is_none());
        // unknown object + errors ⇒ still pass through (index can't be trusted)
        assert!(validation_block(&Verdict {
            object_known: false,
            errors: vec![(0, "anything".into())],
        })
        .is_none());
        // known object + field errors ⇒ block, message names both escapes
        let msg = validation_block(&Verdict {
            object_known: true,
            errors: vec![(8, "Unknown field 'Naem' on Account — did you mean 'Name'?".into())],
        })
        .unwrap();
        assert!(msg.contains("did you mean 'Name'"));
        assert!(msg.contains("ost_sync") && msg.contains("skipValidation"), "{msg}");
    }

    #[test]
    fn shapes_result_with_truncation_warning() {
        let qr = features::soql::QueryResult { total_size: 500, done: false, records: vec![] };
        let dto = shape(&qr, "SFDC_Staging", 200);
        assert_eq!(dto.total_size, 500);
        assert!(!dto.done);
        let w = dto.warning.unwrap();
        assert!(w.contains("200") && w.contains("500"), "{w}");
    }

    /// Single-page row-cap overflow: Salesforce's default REST batch can return
    /// up to 2000 rows in ONE page with done=true. The truncation must still be
    /// detected from row count alone.
    #[test]
    fn shapes_single_page_overflow_as_truncated() {
        let limit = 3;
        let records: Vec<features::soql::Record> = (0..5)
            .map(|i| features::soql::Record {
                sobject_type: "Account".into(),
                fields: vec![(
                    "Id".into(),
                    features::soql::FieldValue::Scalar(serde_json::Value::String(format!(
                        "001{i}"
                    ))),
                )],
            })
            .collect();
        let qr = features::soql::QueryResult { total_size: 5, done: true, records };
        let dto = shape(&qr, "SFDC_Staging", limit);
        assert!(!dto.done, "single-page overflow must report done=false");
        assert_eq!(dto.returned, limit);
        let w = dto.warning.expect("truncation warning must fire");
        assert!(w.contains(&limit.to_string()) && w.contains('5'), "{w}");
    }
}
