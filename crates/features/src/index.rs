//! One-time full index of an org's symbols into a persisted offline OST.

use std::path::PathBuf;

use apex_lang::acquire::{parse_org_types, parse_stdlib};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::symbols::ApexType;
use apex_lang::{save_snapshot, IndexManifest, Ost};
use sf_core::{SfError, SfInvoker};
use sf_schema::SchemaStore;

use crate::apex_complete::schema_to_apex_type;
use crate::api_version::api_version_for;
use crate::soql::list_sobject_names;

/// Max sObject describes in flight during indexing (bounds wall time without
/// hammering the org).
const DESCRIBE_CONCURRENCY: usize = 8;

#[derive(Clone, Debug)]
pub struct IndexProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

/// Full index: stdlib + every org Apex class + every sObject. Persists a
/// snapshot and returns the assembled OST. `on_progress` is called per phase
/// and per sObject described.
pub async fn index_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org_id: &str,
    on_progress: &mut (dyn FnMut(IndexProgress) + Send),
) -> Result<Ost, SfError> {
    let api = api_version_for(invoker, org_id).await;

    on_progress(IndexProgress {
        phase: "stdlib",
        done: 0,
        total: 1,
    });
    let mut ost_store = OstStore::new(root.clone(), org_id);
    let stdlib = ost_store
        .get_or_fetch(invoker, &api, OstSource::Stdlib)
        .await?;
    let namespaces = parse_stdlib(&stdlib);
    on_progress(IndexProgress {
        phase: "stdlib",
        done: 1,
        total: 1,
    });

    on_progress(IndexProgress {
        phase: "classes",
        done: 0,
        total: 1,
    });
    let org_types_raw = ost_store
        .get_or_fetch(invoker, &api, OstSource::OrgTypes)
        .await?;
    let class_count;
    let mut org_types = match &org_types_raw {
        serde_json::Value::Array(records) => {
            let parsed = parse_org_types(records);
            class_count = parsed.len();
            parsed
        }
        _ => {
            class_count = 0;
            Vec::new()
        }
    };
    on_progress(IndexProgress {
        phase: "classes",
        done: class_count,
        total: class_count,
    });

    let names = list_sobject_names(invoker, org_id).await;
    let total = names.len();
    let mut sobjects = 0;
    let mut done = 0;
    // Describe sObjects up to DESCRIBE_CONCURRENCY at a time: serial describes
    // (one `sf` call each) make a large org's first index take many minutes.
    // Each task gets its own SchemaStore (disk cache is the shared truth; per
    // object → distinct files, so concurrent writes never collide).
    for chunk in names.chunks(DESCRIBE_CONCURRENCY) {
        let mut set: tokio::task::JoinSet<Option<ApexType>> = tokio::task::JoinSet::new();
        for name in chunk {
            let invoker = invoker.clone();
            let api = api.clone();
            let root = root.clone();
            let org = org_id.to_string();
            let name = name.clone();
            set.spawn(async move {
                let mut store = SchemaStore::new(root, &org);
                store
                    .get_or_fetch(&invoker, &api, &name)
                    .await
                    .ok()
                    .map(|s| schema_to_apex_type(&s))
            });
        }
        while let Some(res) = set.join_next().await {
            done += 1;
            if let Ok(Some(ty)) = res {
                org_types.push(ty);
                sobjects += 1;
            }
            on_progress(IndexProgress {
                phase: "sobjects",
                done,
                total,
            });
        }
    }

    let ost = Ost {
        namespaces,
        org_types,
    };
    let manifest = IndexManifest {
        org_id: org_id.to_string(),
        api_version: api,
        indexed_at: now_iso8601(),
        namespaces: ost.namespaces.len(),
        classes: class_count,
        sobjects,
    };
    save_snapshot(&root, &ost, &manifest).map_err(SfError::Spawn)?;
    on_progress(IndexProgress {
        phase: "done",
        done: total,
        total,
    });
    Ok(ost)
}

fn now_iso8601() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso8601_utc(secs)
}

/// Format a Unix timestamp as RFC3339 UTC (`YYYY-MM-DDTHH:MM:SSZ`). Phase 2's
/// delta poll compares this against SOQL `LastModifiedDate`, so it must be a
/// real timestamp, not an opaque epoch string.
fn iso8601_utc(secs: u64) -> String {
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Howard Hinnant's days-since-epoch → (year, month, day). Valid for all dates.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::{runner::MockRunner, RawOutput, SfError, SfInvoker};
    use std::sync::Arc;

    fn ok(stdout: &str) -> Result<RawOutput, SfError> {
        Ok(RawOutput {
            status: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
        })
    }

    #[test]
    fn iso8601_formats_known_instants() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(iso8601_utc(1_609_459_200), "2021-01-01T00:00:00Z");
    }

    #[tokio::test]
    async fn index_assembles_classes_and_sobjects_and_persists() {
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("completions") {
                ok(
                    r#"{"publicDeclarations":{"System":{"Math":{"methods":[],"properties":[],"constructors":[]}}}}"#,
                )
            } else if a.contains("ApexClass") {
                ok(
                    r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","tableDeclaration":{"name":"Foo"},"methods":[],"properties":[],"innerClasses":[],"interfaces":[]}}]}}"#,
                )
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}"#,
                )
            }
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let root = std::env::temp_dir().join(format!("idx-{}", std::process::id()));
        let mut phases = vec![];
        let ost = index_org(&invoker, root.clone(), "myorg", &mut |p| {
            phases.push(p.phase)
        })
        .await
        .unwrap();

        assert!(
            ost.org_types.iter().any(|t| t.name == "Foo"),
            "org class present"
        );
        assert!(
            ost.org_types.iter().any(|t| t.name == "Account"),
            "sObject present"
        );
        assert!(
            ost.namespaces.iter().any(|n| n.name == "System"),
            "stdlib present"
        );
        assert!(root.join("myorg/index.json").exists(), "snapshot written");
        assert!(phases.contains(&"sobjects"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
