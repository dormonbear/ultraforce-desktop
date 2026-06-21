//! One-time full index of an org's symbols into a persisted offline OST.

use std::path::PathBuf;

use apex_lang::acquire::{parse_org_types, parse_stdlib};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::{save_snapshot, IndexManifest, Ost};
use sf_core::{SfError, SfInvoker};
use sf_schema::SchemaStore;

use crate::apex_complete::schema_to_apex_type;
use crate::api_version::api_version_for;
use crate::soql::list_sobject_names;

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
    on_progress: &mut dyn FnMut(IndexProgress),
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
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for (i, name) in names.iter().enumerate() {
        if let Ok(schema) = schema_store.get_or_fetch(invoker, &api, name).await {
            org_types.push(schema_to_apex_type(&schema));
            sobjects += 1;
        }
        on_progress(IndexProgress {
            phase: "sobjects",
            done: i + 1,
            total,
        });
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
    format!("epoch:{secs}")
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
