//! Real end-to-end tests against a live Salesforce org (the `ultraforce` dev
//! edition by default). These exercise the actual `sf` CLI → real org → real
//! parse/describe path for every backend capability added in the UltraForce
//! milestone. Ignored by default (they hit the network and one performs DML).
//!
//! Run all:
//!   cargo test -p features --test real_org_e2e -- --ignored --test-threads=1
//! Override the target org:
//!   UF_E2E_ORG=myalias cargo test -p features --test real_org_e2e -- --ignored
//!
//! Integration tests can use the crate's regular deps (soql-lang, sf-schema).

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use features::anon_apex::run_anon;
use features::apex_complete::ApexCompleter;
use features::soql::{complete_fields, diagnose, list_sobject_names, run_query, QueryOptions};
use sf_core::{ProcessRunner, SfInvoker};
use sf_schema::SchemaStore;

fn org() -> String {
    std::env::var("UF_E2E_ORG").unwrap_or_else(|_| "ultraforce".to_string())
}

fn invoker() -> SfInvoker {
    SfInvoker::new(Arc::new(ProcessRunner))
}

fn labels(cands: &[soql_lang::Candidate]) -> Vec<String> {
    cands.iter().map(|c| c.label.clone()).collect()
}

/// #1 — org API version is detected from the live org (not the 60.0 fallback path errors).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_api_version_detected() {
    let v = features::api_version::api_version_for(&invoker(), &org()).await;
    assert!(
        v.contains('.'),
        "api version should look like NN.0, got {v:?}"
    );
    let major: f64 = v.parse().unwrap_or(0.0);
    assert!(major >= 50.0, "api version unexpectedly low: {v}");
}

/// #1 (FROM source) — the org's sObject list is fetched and contains standard objects.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_list_sobject_names() {
    let names = list_sobject_names(&invoker(), &org()).await;
    assert!(!names.is_empty(), "expected a non-empty sObject list");
    assert!(names.iter().any(|n| n == "Account"), "Account missing");
    assert!(names.iter().any(|n| n == "Contact"), "Contact missing");
}

/// #1 — SOQL completion against a real Account describe: real fields + functions
/// + clause keywords in SELECT, and real object names in FROM.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_soql_completion_real() {
    let inv = invoker();
    let root = SchemaStore::default_root();

    // SELECT position → real fields + a function + the FROM keyword (no object
    // list needed here).
    let select = complete_fields(&inv, &root, &org(), "SELECT  FROM Account", 7, &[]).await;
    let l = labels(&select);
    assert!(
        l.iter().any(|x| x == "Name"),
        "real field Name missing: {l:?}"
    );
    assert!(l.iter().any(|x| x == "Id"), "real field Id missing");
    assert!(l.iter().any(|x| x == "COUNT"), "function COUNT missing");
    assert!(l.iter().any(|x| x == "FROM"), "keyword FROM missing");
    assert!(
        select
            .iter()
            .any(|c| c.kind == soql_lang::CandidateKind::Function),
        "expected at least one Function-kind candidate"
    );

    // FROM position → real object names filtered by the typed prefix (the caller
    // now owns the cached object list, mirroring the desktop app).
    let objects = list_sobject_names(&inv, &org()).await;
    let from = complete_fields(&inv, &root, &org(), "SELECT Id FROM Acc", 18, &objects).await;
    let lf = labels(&from);
    assert!(
        lf.iter().any(|x| x == "Account"),
        "FROM should offer Account: {lf:?}"
    );
    assert!(
        from.iter()
            .any(|c| c.kind == soql_lang::CandidateKind::Object),
        "expected Object-kind candidates in FROM"
    );
}

/// SOQL unknown-field diagnostics against the real describe (ground truth).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_soql_diagnostics_real() {
    let inv = invoker();
    let root = SchemaStore::default_root();

    let bad = diagnose(&inv, &root, &org(), "SELECT NotARealField__c FROM Account").await;
    assert!(!bad.is_empty(), "unknown field should be flagged");

    let good = diagnose(&inv, &root, &org(), "SELECT Id, Name FROM Account").await;
    assert!(
        good.is_empty(),
        "valid fields should not be flagged: {good:?}"
    );
}

/// run_soql round-trips a real query.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_run_soql_real() {
    let result = run_query(
        &invoker(),
        "SELECT Id, Name FROM Account LIMIT 5",
        Some(&org()),
        QueryOptions::default(),
    )
    .await
    .expect("run_soql should succeed");
    assert!(result.done, "query should be done");
    assert!(result.total_size <= 5, "LIMIT 5 should cap rows");
    let table = result.to_table();
    assert!(
        table.columns.iter().any(|c| c == "Name"),
        "Name column expected"
    );
}

/// run_apex executes a benign anonymous-Apex debug statement.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_run_apex_debug() {
    let out = run_anon(&invoker(), "System.debug('ultraforce-e2e');", Some(&org()))
        .await
        .expect("run_apex should succeed");
    assert!(out.result.compiled, "should compile");
    assert!(out.result.success, "should run: {:?}", out.result.error());
    assert!(!out.result.logs.is_empty(), "should return a debug log");
}

/// Offline-schema refresh: describe writes the cache, clear() wipes it.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_schema_cache_clear() {
    let inv = invoker();
    let root = SchemaStore::default_root();
    let api = features::api_version::api_version_for(&inv, &org()).await;

    let mut s1 = SchemaStore::new(&root, org());
    let schema = s1
        .get_or_fetch(&inv, &api, "Account")
        .await
        .expect("describe Account");
    assert!(!schema.fields.is_empty(), "Account should have fields");

    let mut s2 = SchemaStore::new(&root, org());
    let removed = s2.clear().expect("clear should succeed");
    assert!(
        removed >= 1,
        "clear should remove >=1 cached object, got {removed}"
    );
}

/// Apex completion drives the real OST + on-demand sObject describe.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_apex_completion_sobject() {
    let completer = ApexCompleter::with_default_root();
    // `Account a; a.Na` — receiver `a` resolves to the Account sObject, whose
    // describe is fetched on demand (no bulk org-class fetch).
    let src = "Account a; a.Na";
    let cands = completer
        .complete(&invoker(), &org(), src, src.len(), &[])
        .await
        .expect("apex completion should succeed");
    let l: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(!l.is_empty(), "expected member candidates after `a.Na`");
    assert!(l.contains(&"Name"), "Account.Name should complete: {l:?}");
}

/// Top-level org Apex CLASS NAME completion via the cheap names-only fetch
/// (no bulk SymbolTable pull).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_apex_top_level_class_names() {
    let completer = ApexCompleter::with_default_root();
    let src = "Experience";
    let cands = completer
        .complete(&invoker(), &org(), src, src.len(), &[])
        .await
        .expect("apex completion should succeed");
    let l: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(
        l.contains(&"ExperienceController"),
        "org class name should complete at top level: {l:?}"
    );
}

/// On-demand upgrade: a name-only class stub fetches its full SymbolTable when a
/// member is accessed.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_apex_class_member_on_demand() {
    let completer = ApexCompleter::with_default_root();
    // Empty prefix — the `.` trigger fires with nothing typed yet.
    let src = "ExperienceController.";
    let cands = completer
        .complete(&invoker(), &org(), src, src.len(), &[])
        .await
        .expect("apex completion should succeed");
    let l: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(
        l.contains(&"getExperiences"),
        "static member should complete on `.` with empty prefix: {l:?}"
    );
}

/// #DML — insert → query → delete round-trip via the app's real command surface.
/// Cleanup (delete) runs BEFORE the assertions so a failed assert never leaks
/// the test record.
#[tokio::test]
#[ignore = "hits the live org and performs DML; run with --ignored"]
async fn e2e_dml_insert_query_delete() {
    let inv = invoker();
    let o = org();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let marker = format!("UF_E2E_{nanos}");

    // Insert.
    let ins = run_anon(
        &inv,
        &format!("insert new Account(Name='{marker}');"),
        Some(&o),
    )
    .await
    .expect("insert call");
    assert!(
        ins.result.success,
        "insert failed: {:?}",
        ins.result.error()
    );

    // Query for it.
    let q1 = run_query(
        &inv,
        &format!("SELECT Id, Name FROM Account WHERE Name = '{marker}'"),
        Some(&o),
        QueryOptions::default(),
    )
    .await
    .expect("post-insert query");

    // Clean up FIRST (so assertion failures below never leak the record).
    let del = run_anon(
        &inv,
        &format!("delete [SELECT Id FROM Account WHERE Name = '{marker}'];"),
        Some(&o),
    )
    .await
    .expect("delete call");
    assert!(
        del.result.success,
        "delete failed: {:?}",
        del.result.error()
    );

    // Verify the delete actually removed it.
    let q2 = run_query(
        &inv,
        &format!("SELECT Id FROM Account WHERE Name = '{marker}'"),
        Some(&o),
        QueryOptions::default(),
    )
    .await
    .expect("post-delete query");

    assert_eq!(
        q1.total_size, 1,
        "inserted record should be found exactly once"
    );
    assert_eq!(q2.total_size, 0, "record should be gone after delete");
}

/// Offline index (reference-plugin-style) — the full index runs end-to-end against the live
/// org: stdlib + every Apex class + every sObject (8-concurrent describes),
/// persisted to a snapshot that reloads identically, then served with ZERO
/// further network calls (proven by an invoker that panics on any sf call).
/// Can take minutes on a large org (the one-time cost the design accepts).
#[tokio::test]
#[ignore = "hits the live org; full index can take minutes; run with --ignored"]
async fn e2e_index_org_offline() {
    let inv = invoker();
    let o = org();
    let root = std::env::temp_dir().join(format!("uf-e2e-index-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    let (api, _) = features::api_version::resolve_index_api_version(&inv, &root, &o).await;
    let mut phases: Vec<&'static str> = vec![];
    let ost = features::index::index_org(
        &inv,
        root.clone(),
        &o,
        &api,
        &features::index::NamespacePolicy::All,
        &mut |p| {
            if phases.last() != Some(&p.phase) {
                phases.push(p.phase);
            }
        },
    )
    .await
    .expect("index_org against live org");

    // Assembled OST carries all three sources.
    assert!(
        ost.namespaces.iter().any(|n| n.name == "System"),
        "stdlib System namespace missing"
    );
    assert!(
        ost.org_types.iter().any(|t| t.name == "Account"),
        "Account sObject type missing from index"
    );
    assert!(
        ost.org_types.len() > 50,
        "expected many org types, got {}",
        ost.org_types.len()
    );
    assert!(
        phases.contains(&"stdlib") && phases.contains(&"classes") && phases.contains(&"sobjects"),
        "all phases should fire: {phases:?}"
    );

    // Snapshot persisted and reloads to exactly the same OST.
    let (loaded, manifest) = apex_lang::load_snapshot(&root, &o, &api).expect("snapshot reload");
    assert_eq!(loaded, ost, "reloaded OST must equal the indexed one");
    assert!(
        manifest.indexed_at.ends_with('Z'),
        "manifest timestamp should be ISO8601 UTC: {}",
        manifest.indexed_at
    );
    assert!(manifest.sobjects > 0 && manifest.namespaces > 0);

    // Offline serve: install the index, then complete with an invoker that
    // PANICS on any sf call — proving zero on-demand network once indexed.
    let completer = ApexCompleter::new(root.clone());
    completer.install_index(&o, ost);
    let panicking = SfInvoker::new(Arc::new(sf_core::runner::MockRunner::new(|_p, _a| {
        panic!("indexed completion must not hit the network")
    })));
    let src = "Account a; a.";
    let cands = completer
        .complete(&panicking, &o, src, src.len(), &[])
        .await
        .expect("offline complete");
    assert!(
        cands.iter().any(|c| c.label == "Name"),
        "offline Account.Name missing: {cands:?}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// Delta sync against a live org with a future watermark = no changed classes,
/// fast, and reconcile drops a fake type while keeping a real one. Seeds a tiny
/// snapshot first (a full index would take minutes).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_sync_org_noop() {
    use apex_lang::symbols::{ApexType, Ost};
    let inv = invoker();
    let o = org();
    let root = std::env::temp_dir().join(format!("uf-e2e-sync-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    let api = features::api_version::api_version_for(&inv, &o).await;
    let seeded = Ost {
        namespaces: vec![],
        org_types: vec![
            ApexType {
                name: "Account".into(),
                ..Default::default()
            },
            ApexType {
                name: "ZzzNotARealType".into(),
                ..Default::default()
            },
        ],
    };
    let m = apex_lang::IndexManifest {
        org_id: o.clone(),
        api_version: api.clone(),
        indexed_at: "2999-01-01T00:00:00Z".into(),
        namespaces: 0,
        classes: 0,
        sobjects: 0,
        stdlib_error: None,
    };
    apex_lang::save_snapshot(&root, &seeded, &m).unwrap();

    let (outcome, ost) = features::index::sync_org(
        &inv,
        root.clone(),
        &o,
        &api,
        &features::index::NamespacePolicy::All,
    )
    .await
    .expect("delta sync against live org");

    assert_eq!(outcome.added, 0, "no adds with a future watermark");
    assert_eq!(outcome.updated, 0, "no updates with a future watermark");
    assert!(
        ost.org_types.iter().any(|t| t.name == "Account"),
        "Account kept"
    );
    assert!(
        !ost.org_types.iter().any(|t| t.name == "ZzzNotARealType"),
        "fake removed"
    );
    assert!(outcome.removed >= 1, "fake type reconciled away");

    let (_, m2) = apex_lang::load_snapshot(&root, &o, &api).unwrap();
    assert_ne!(m2.indexed_at, "2999-01-01T00:00:00Z", "watermark advanced");
    let _ = std::fs::remove_dir_all(&root);
}
