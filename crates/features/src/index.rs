//! One-time full index of an org's symbols into a persisted offline OST.

use std::path::PathBuf;

use apex_lang::acquire::{
    fetch_apex_class_names, fetch_changed_apex_classes, fetch_changed_entities, parse_org_types,
    parse_stdlib,
};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::symbols::ApexType;
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
    // Describe all sObjects via batched Composite REST (25 per call, up to 4
    // calls concurrently) instead of one `sf` process per object — the latter
    // made a managed-package org's first index take ~15 min.
    let mut store = SchemaStore::new(root.clone(), org_id);
    let described = store
        .get_or_fetch_many(invoker, &api, &names, &mut |done, _total| {
            on_progress(IndexProgress {
                phase: "sobjects",
                done,
                total,
            });
        })
        .await;
    let mut sobjects = 0;
    for (_name, schema) in &described {
        org_types.push(schema_to_apex_type(schema));
        sobjects += 1;
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

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SyncOutcome {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
}

impl SyncOutcome {
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

/// Insert `ty` into `types`, replacing any same-name (case-insensitive) entry.
/// Returns true when it replaced an existing type (an update), false on add.
fn upsert(types: &mut Vec<ApexType>, ty: ApexType) -> bool {
    if let Some(slot) = types
        .iter_mut()
        .find(|t| t.name.eq_ignore_ascii_case(&ty.name))
    {
        *slot = ty;
        true
    } else {
        types.push(ty);
        false
    }
}

/// Delta sync: patch the snapshot's OST with only what changed since its
/// watermark, persist, and return the patched OST + counts. No-op (zero
/// counts, default OST) when no snapshot exists.
pub async fn sync_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org_id: &str,
) -> Result<(SyncOutcome, Ost), SfError> {
    let api = api_version_for(invoker, org_id).await;
    let Some((mut ost, manifest)) = apex_lang::load_snapshot(&root, org_id, &api) else {
        return Ok((SyncOutcome::default(), Ost::default()));
    };
    let since = manifest.indexed_at.clone();
    let started_at = now_iso8601();
    let mut outcome = SyncOutcome::default();

    // Changed Apex classes → upsert full SymbolTables.
    let class_records = fetch_changed_apex_classes(invoker, org_id, &since).await?;
    for ty in parse_org_types(&class_records) {
        if upsert(&mut ost.org_types, ty) {
            outcome.updated += 1;
        } else {
            outcome.added += 1;
        }
    }

    // Changed sObjects → evict stale describe, re-describe, upsert.
    let entities = fetch_changed_entities(invoker, org_id, &since).await?;
    let mut schema_store = SchemaStore::new(root.clone(), org_id);
    for name in entities {
        let _ = schema_store.invalidate(&api, &name);
        if let Ok(schema) = schema_store.get_or_fetch(invoker, &api, &name).await {
            if upsert(&mut ost.org_types, schema_to_apex_type(&schema)) {
                outcome.updated += 1;
            } else {
                outcome.added += 1;
            }
        }
    }

    // Deletion reconcile — only when BOTH name lists are non-empty (an empty
    // list means a failed fetch; never wipe the index on that).
    let class_names = fetch_apex_class_names(invoker, org_id)
        .await
        .unwrap_or_default();
    let sobject_names = list_sobject_names(invoker, org_id).await;
    if !class_names.is_empty() && !sobject_names.is_empty() {
        let live: std::collections::HashSet<String> = class_names
            .iter()
            .chain(sobject_names.iter())
            .map(|n| n.to_ascii_lowercase())
            .collect();
        let before = ost.org_types.len();
        ost.org_types
            .retain(|t| live.contains(&t.name.to_ascii_lowercase()));
        outcome.removed = before - ost.org_types.len();
    }

    let manifest = IndexManifest {
        org_id: org_id.to_string(),
        api_version: api,
        indexed_at: started_at,
        namespaces: ost.namespaces.len(),
        classes: class_names.len(),
        sobjects: sobject_names.len(),
    };
    save_snapshot(&root, &ost, &manifest).map_err(SfError::Spawn)?;
    Ok((outcome, ost))
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

    // Build a snapshot on disk for `org` with a known watermark + seeded OST.
    fn seed_snapshot(root: &std::path::Path, org: &str, api: &str, ost: &Ost) {
        let m = IndexManifest {
            org_id: org.into(),
            api_version: api.into(),
            indexed_at: "2026-01-01T00:00:00Z".into(),
            namespaces: ost.namespaces.len(),
            classes: 0,
            sobjects: 0,
        };
        apex_lang::save_snapshot(root, ost, &m).unwrap();
    }

    #[tokio::test]
    async fn sync_upserts_changed_class_and_advances_watermark() {
        let root = std::env::temp_dir().join(format!("sync-up-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Foo".into(),
                ..Default::default()
            }],
        };
        seed_snapshot(&root, "uorg_up", "60.0", &seeded);

        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("FROM ApexClass") && a.contains("LastModifiedDate") {
                ok(
                    r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","methods":[{"name":"bar","returnType":"void","parameters":[]}],"properties":[]}}]}}"#,
                )
            } else if a.contains("FROM EntityDefinition") || a.contains("FROM CustomField") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"Foo"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#,
                )
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "uorg_up").await.unwrap();

        let foo = ost
            .org_types
            .iter()
            .find(|t| t.name == "Foo")
            .expect("Foo present");
        assert!(
            foo.methods.iter().any(|m| m.name == "bar"),
            "Foo upgraded with bar"
        );
        assert_eq!(outcome.updated, 1, "Foo counted as updated");
        let (_, m) = apex_lang::load_snapshot(&root, "uorg_up", "60.0").unwrap();
        assert_ne!(m.indexed_at, "2026-01-01T00:00:00Z", "watermark advanced");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sync_reconciles_deleted_type() {
        let root = std::env::temp_dir().join(format!("sync-del-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![
                ApexType {
                    name: "Keeper".into(),
                    ..Default::default()
                },
                ApexType {
                    name: "Account".into(),
                    ..Default::default()
                },
                ApexType {
                    name: "Gone".into(),
                    ..Default::default()
                },
            ],
        };
        seed_snapshot(&root, "uorg_del", "60.0", &seeded);
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("LastModifiedDate") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"Keeper"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":["Account"]}"#)
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#,
                )
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "uorg_del").await.unwrap();
        assert!(
            ost.org_types.iter().any(|t| t.name == "Keeper"),
            "Keeper kept"
        );
        assert!(
            ost.org_types.iter().any(|t| t.name == "Account"),
            "Account kept"
        );
        assert!(
            !ost.org_types.iter().any(|t| t.name == "Gone"),
            "Gone removed"
        );
        assert_eq!(outcome.removed, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sync_skips_reconcile_when_namelist_empty() {
        let root = std::env::temp_dir().join(format!("sync-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let seeded = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".into(),
                ..Default::default()
            }],
        };
        seed_snapshot(&root, "uorg_guard", "60.0", &seeded);
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("LastModifiedDate") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("SELECT Name FROM ApexClass") {
                ok(r#"{"status":0,"result":{"records":[{"Name":"SomeClass"}]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":[]}"#)
            } else {
                ok(
                    r#"{"status":0,"result":{"name":"Account","fields":[],"childRelationships":[]}}"#,
                )
            }
        });
        let inv = SfInvoker::new(Arc::new(runner));
        let (outcome, ost) = sync_org(&inv, root.clone(), "uorg_guard").await.unwrap();
        assert!(
            ost.org_types.iter().any(|t| t.name == "Account"),
            "Account NOT wiped"
        );
        assert_eq!(outcome.removed, 0, "no reconcile on empty list");
        let _ = std::fs::remove_dir_all(&root);
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
            } else if a.contains("composite") {
                ok(
                    r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","fields":[{"name":"Name","type":"string","relationshipName":null,"referenceTo":[]}],"childRelationships":[]}}]}"#,
                )
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
