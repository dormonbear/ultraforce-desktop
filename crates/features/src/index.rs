//! One-time full index of an org's symbols into a persisted offline OST.

use std::path::PathBuf;

use apex_lang::acquire::{fetch_apex_symbols, parse_org_types, parse_stdlib};
use apex_lang::store::{OstSource, OstStore};
use apex_lang::{IndexManifest, Ost};
use sf_core::{SfError, SfInvoker};
use sf_schema::SchemaStore;

use crate::apex_complete::schema_to_apex_type;

#[derive(Clone, Debug)]
pub struct IndexProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

/// Managed-package namespace filtering for the org index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NamespacePolicy {
    /// Index everything (default).
    All,
    /// Drop anything carrying a managed-package namespace prefix.
    Unmanaged,
    /// Keep unmanaged names plus the listed namespace prefixes.
    Allow(Vec<String>),
}

/// Salesforce custom-object/field API suffixes — these are not namespace prefixes.
const CUSTOM_SUFFIXES: &[&str] = &[
    "__c",
    "__r",
    "__e",
    "__b",
    "__x",
    "__mdt",
    "__Share",
    "__Tag",
    "__History",
    "__Feed",
    "__ChangeEvent",
    "__kav",
    "__pc",
];

/// Fail-loud helper: when `parse_stdlib` finds no namespaces, extract any
/// error text the raw completions payload carries — either a REST error
/// array (`[{"errorCode":...,"message":...}]`) or a top-level `error`/
/// `message` field — falling back to a generic message otherwise.
fn stdlib_error_message(raw: &serde_json::Value) -> String {
    if let Some(arr) = raw.as_array() {
        if let Some(msg) = arr
            .iter()
            .find_map(|e| e.get("message").and_then(|m| m.as_str()))
        {
            return msg.to_string();
        }
    }
    if let Some(msg) = raw
        .get("message")
        .or_else(|| raw.get("error"))
        .and_then(|m| m.as_str())
    {
        return msg.to_string();
    }
    "stdlib completions returned no namespaces".to_string()
}

/// The managed-package namespace of an sObject API name, or `None` for standard /
/// unmanaged names. `ns__Obj__c` → `Some("ns")`; `Obj__c` and `Account` → `None`.
fn namespace_of(name: &str) -> Option<&str> {
    let stem = CUSTOM_SUFFIXES
        .iter()
        .find_map(|s| name.strip_suffix(s))
        .unwrap_or(name);
    stem.split_once("__").map(|(ns, _)| ns)
}

impl NamespacePolicy {
    /// Whether `name` is kept under this policy.
    pub fn permits(&self, name: &str) -> bool {
        match self {
            NamespacePolicy::All => true,
            NamespacePolicy::Unmanaged => namespace_of(name).is_none(),
            NamespacePolicy::Allow(list) => match namespace_of(name) {
                None => true,
                Some(ns) => list.iter().any(|a| a.eq_ignore_ascii_case(ns)),
            },
        }
    }

    /// Parse the desktop setting: `"all"` | `"unmanaged"` | `"ns1,ns2,…"`.
    pub fn parse(s: &str) -> NamespacePolicy {
        match s.trim() {
            "" | "all" => NamespacePolicy::All,
            "unmanaged" => NamespacePolicy::Unmanaged,
            other => NamespacePolicy::Allow(
                other
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect(),
            ),
        }
    }
}

/// Full index: stdlib + every org Apex class + every sObject. Persists a
/// snapshot (keyed on `api`, resolve via
/// [`crate::api_version::resolve_index_api_version`]) and returns the
/// assembled OST. `on_progress` is called per phase and per sObject described.
pub async fn index_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org_id: &str,
    api: &str,
    policy: &NamespacePolicy,
    on_progress: &mut (dyn FnMut(IndexProgress) + Send),
) -> Result<Ost, SfError> {
    let expected = apex_lang::snapshot::generation_token(&root, org_id).map_err(SfError::Spawn)?;
    // Keep changes made during acquisition eligible for the next delta sync.
    let indexed_at = now_iso8601();
    let started = std::time::Instant::now();
    tracing::info!(org = %org_id, api = %api, "index_org start (full index)");

    on_progress(IndexProgress {
        phase: "stdlib",
        done: 0,
        total: 1,
    });
    let mut ost_store = OstStore::new(root.clone(), org_id);
    let stdlib = ost_store
        .get_or_fetch(invoker, api, OstSource::Stdlib)
        .await?;
    let namespaces = parse_stdlib(&stdlib);
    let stdlib_error = if namespaces.is_empty() {
        Some(stdlib_error_message(&stdlib))
    } else {
        None
    };
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
    // A full rebuild must fetch current org symbols, rather than relabel an old
    // raw cache with a fresh generation watermark.
    let org_types_raw = fetch_apex_symbols(invoker, org_id).await?;
    delta::validate_sources(&org_types_raw)?;
    let mut org_types = parse_org_types(&org_types_raw);
    let class_count = org_types_raw.len();
    on_progress(IndexProgress {
        phase: "classes",
        done: class_count,
        total: class_count,
    });

    // Namespace policy filters sObjects (their API names carry the `ns__` prefix).
    // ponytail: sObjects only — Apex class names lack the namespace prefix
    // (ApexClass.NamespacePrefix isn't queried), so managed classes can't be
    // filtered here without an extra query.
    let mut list_args = vec!["sobject", "list", "--sobject", "all"];
    if org_id != "default" {
        list_args.extend(["--target-org", org_id]);
    }
    let names: Vec<String> = invoker
        .run_json::<Vec<String>>(&list_args)
        .await?
        .into_iter()
        .filter(|n| policy.permits(n))
        .collect();
    let total = names.len();
    // Describe all sObjects via batched Composite REST (25 per call, up to 4
    // calls concurrently) instead of one `sf` process per object — the latter
    // made a managed-package org's first index take ~15 min.
    let mut store = SchemaStore::new(root.clone(), org_id);
    let described = store
        .fetch_many(invoker, api, &names, &mut |done, _total| {
            on_progress(IndexProgress {
                phase: "sobjects",
                done,
                total,
            });
        })
        .await;
    // Persist all described objects in ONE transaction so a concurrent reader
    // (e.g. the MCP server during an `ost_reindex`) never sees a partial index.
    let schemas: Vec<_> = described.iter().map(|(_, s)| s.clone()).collect();
    ensure_complete_describes(&names, &schemas)?;
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
        api_version: api.to_string(),
        indexed_at,
        namespaces: ost.namespaces.len(),
        classes: class_count,
        sobjects,
        stdlib_error,
    };
    apex_lang::snapshot::save_generation(
        &root,
        &ost,
        &manifest,
        &schemas,
        true,
        Some(&org_types_raw),
        &expected,
    )
    .map_err(SfError::Spawn)?;
    tracing::info!(
        org = %org_id,
        classes = class_count,
        sobjects,
        namespaces = ost.namespaces.len(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        "index_org complete"
    );
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

#[path = "index_delta.rs"]
mod delta;
pub use delta::sync_org;

fn ensure_complete_describes(
    names: &[String],
    schemas: &[sf_schema::SObjectSchema],
) -> Result<(), SfError> {
    if names.iter().all(|name| {
        schemas
            .iter()
            .any(|schema| schema.name.eq_ignore_ascii_case(name))
    }) {
        return Ok(());
    }
    Err(SfError::Spawn(std::io::Error::other(
        "schema describe incomplete; previous snapshot retained — retry indexing",
    )))
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

    #[test]
    fn namespace_of_detects_managed_names() {
        assert_eq!(namespace_of("Account"), None);
        assert_eq!(namespace_of("Obj__c"), None); // unmanaged custom
        assert_eq!(namespace_of("ns__Obj__c"), Some("ns")); // managed custom
        assert_eq!(namespace_of("ns__MyClass"), Some("ns")); // managed apex/name
        assert_eq!(namespace_of("My_Object__c"), None); // underscore in base name
    }

    #[test]
    fn policy_permits() {
        let all = NamespacePolicy::All;
        let unmanaged = NamespacePolicy::Unmanaged;
        let allow = NamespacePolicy::Allow(vec!["keepme".to_string()]);
        assert!(all.permits("ns__Obj__c"));
        assert!(unmanaged.permits("Account"));
        assert!(unmanaged.permits("Obj__c"));
        assert!(!unmanaged.permits("ns__Obj__c"));
        assert!(allow.permits("Account")); // unmanaged always kept
        assert!(allow.permits("KeepMe__Obj__c")); // case-insensitive
        assert!(!allow.permits("other__Obj__c"));
    }

    #[test]
    fn policy_parse() {
        assert_eq!(NamespacePolicy::parse("all"), NamespacePolicy::All);
        assert_eq!(NamespacePolicy::parse(""), NamespacePolicy::All);
        assert_eq!(
            NamespacePolicy::parse("unmanaged"),
            NamespacePolicy::Unmanaged
        );
        assert_eq!(
            NamespacePolicy::parse("a, b ,c"),
            NamespacePolicy::Allow(vec!["a".to_string(), "b".to_string(), "c".to_string()])
        );
    }

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
        let ost = index_org(
            &invoker,
            root.clone(),
            "myorg",
            "60.0",
            &NamespacePolicy::All,
            &mut |p| phases.push(p.phase),
        )
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
        assert!(root.join("myorg/index.db").exists(), "snapshot written");
        assert!(phases.contains(&"sobjects"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn index_records_stdlib_error_when_completions_have_no_namespaces() {
        let runner = MockRunner::new(|_p, args: &[String]| {
            let a = args.join(" ");
            if a.contains("org display") {
                ok(r#"{"status":0,"result":{"apiVersion":"60.0"}}"#)
            } else if a.contains("completions") {
                // No `publicDeclarations` key → parse_stdlib returns no namespaces.
                ok(r#"{"errorCode":"NOT_FOUND","message":"completions unavailable"}"#)
            } else if a.contains("ApexClass") {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            } else if a.contains("sobject list") {
                ok(r#"{"status":0,"result":[]}"#)
            } else {
                ok(r#"{"status":0,"result":{"records":[]}}"#)
            }
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        let root = std::env::temp_dir().join(format!("idx-stdlib-err-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        // Unique org id: `api_version_for` caches process-wide by org id, and
        // other test modules also use "myorg" with a different mocked version.
        index_org(
            &invoker,
            root.clone(),
            "org_stdlib_err",
            "60.0",
            &NamespacePolicy::All,
            &mut |_| {},
        )
        .await
        .unwrap();

        let (_, manifest) = apex_lang::load_snapshot(&root, "org_stdlib_err", "60.0")
            .expect("snapshot persisted despite stdlib failure");
        assert_eq!(
            manifest.stdlib_error,
            Some("completions unavailable".to_string())
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
#[path = "index_watermark_tests.rs"]
mod watermark_tests;

#[cfg(test)]
#[path = "index_deletion_tests.rs"]
mod deletion_tests;
