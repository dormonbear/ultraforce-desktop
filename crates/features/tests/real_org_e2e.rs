//! Real end-to-end tests against an explicitly selected, disposable Salesforce
//! scratch org. Ignored by default: they use the network and one performs DML.
//! 针对明确指定的一次性 Salesforce 临时组织运行端到端测试。默认跳过：测试会访问网络，
//! 其中一项会执行 DML。
//!
//! Run after deploying the synthetic fixture and seeding its Account:
//! 部署合成夹具并创建其 Account 后运行：
//!   UF_E2E_ORG=my-scratch cargo test -p features --test real_org_e2e -- --ignored --test-threads=1
//!
//! Integration tests can use the crate's regular deps (soql-lang, sf-schema).

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

use features::anon_apex::run_anon;
use features::apex_complete::ApexCompleter;
use features::soql::{complete_fields, diagnose, list_sobject_names, run_query, QueryOptions};
use sf_core::{ProcessRunner, SfInvoker};
use sf_schema::SchemaStore;

fn explicit_org(value: Option<&str>) -> Result<String, &'static str> {
    value.map(str::trim).filter(|s| !s.is_empty() && *s != "default")
        .map(str::to_owned)
        .ok_or("Set UF_E2E_ORG to an explicit disposable scratch org / 请将 UF_E2E_ORG 设为明确的一次性临时组织")
}

fn org() -> String {
    explicit_org(std::env::var("UF_E2E_ORG").ok().as_deref())
        .expect("explicit scratch org required / 需要明确指定临时组织")
}

struct TestRoot(PathBuf);

impl TestRoot {
    fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "uf-real-org-{}-{nanos}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).expect("create isolated test cache / 创建隔离测试缓存");
        Self(root)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
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
    let (v, detected) = features::api_version::api_version_for_checked(&invoker(), &org()).await;
    assert!(
        detected,
        "version must come from the org / 版本必须来自组织"
    );
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
    let temp = TestRoot::new();
    let root = temp.path();

    // SELECT position → real fields + a function + the FROM keyword (no object
    // list needed here).
    let select = complete_fields(&inv, root, &org(), "SELECT  FROM Account", 7, &[]).await;
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
    let from = complete_fields(&inv, root, &org(), "SELECT Id FROM Acc", 18, &objects).await;
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
    let temp = TestRoot::new();
    let root = temp.path();

    let bad = diagnose(
        &inv,
        root,
        &org(),
        "SELECT NotARealField__c FROM Account LIMIT 1",
    )
    .await;
    assert!(!bad.is_empty(), "unknown field should be flagged");

    let good = diagnose(&inv, root, &org(), "SELECT Id, Name FROM Account LIMIT 1").await;
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
        "SELECT Id, Name FROM Account WHERE Name = 'UltraForce synthetic CI' LIMIT 5",
        Some(&org()),
        QueryOptions::default(),
    )
    .await
    .expect("run_soql should succeed");
    assert!(result.done, "query should be done");
    assert!(result.total_size <= 5, "LIMIT 5 should cap rows");
    assert!(
        result.total_size >= 1,
        "synthetic Account is required / 需要合成 Account"
    );
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
    let temp = TestRoot::new();
    let target = org();
    let api = features::api_version::api_version_for(&inv, &target).await;
    verify_schema_cache_clear(&inv, temp.path(), &target, &api).await;
}

async fn verify_schema_cache_clear(inv: &SfInvoker, root: &Path, target: &str, api: &str) {
    let mut s1 = SchemaStore::new(root, target);
    let schema = s1
        .get_or_fetch(inv, api, "Account")
        .await
        .expect("describe Account");
    assert!(!schema.fields.is_empty(), "Account should have fields");

    let mut s2 = SchemaStore::new(root, target);
    let removed = s2.clear().expect("clear should succeed");
    assert!(
        removed >= 1,
        "clear should remove >=1 cached object, got {removed}"
    );
    assert!(
        !sf_schema::sqlite::db_path(root, target).exists(),
        "cache database is removed / 缓存数据库已移除"
    );
    assert!(
        s2.load_disk(api, "Account").unwrap().is_none(),
        "cleared schema cannot be loaded / 已清除的架构无法读取"
    );
}

#[tokio::test]
async fn synthetic_on_demand_schema_cache_can_be_cleared() {
    let temp = TestRoot::new();
    let inv = SfInvoker::new(Arc::new(sf_core::runner::MockRunner::ok_json(
        include_str!("../../sf-schema/tests/fixtures/describe_account.json"),
    )));
    verify_schema_cache_clear(&inv, temp.path(), "synthetic", "60.0").await;
}

/// Apex completion drives the real OST + on-demand sObject describe.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_apex_completion_sobject() {
    let temp = TestRoot::new();
    let completer = ApexCompleter::new(temp.path());
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
    let temp = TestRoot::new();
    let completer = ApexCompleter::new(temp.path());
    let src = "UfE2e";
    let cands = completer
        .complete(&invoker(), &org(), src, src.len(), &[])
        .await
        .expect("apex completion should succeed");
    let l: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(
        l.contains(&"UfE2eFixture"),
        "org class name should complete at top level: {l:?}"
    );
}

/// On-demand upgrade: a name-only class stub fetches its full SymbolTable when a
/// member is accessed.
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_apex_class_member_on_demand() {
    let temp = TestRoot::new();
    let completer = ApexCompleter::new(temp.path());
    // Empty prefix — the `.` trigger fires with nothing typed yet.
    let src = "UfE2eFixture.";
    let cands = completer
        .complete(&invoker(), &org(), src, src.len(), &[])
        .await
        .expect("apex completion should succeed");
    let l: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(
        l.contains(&"fixtureValue"),
        "static member should complete on `.` with empty prefix: {l:?}"
    );
}

/// #DML — insert → query → delete through the real command surface. After a
/// successful insert, attempt deletion even when the first query fails.
/// #DML — 通过真实命令界面完成插入、查询和删除。插入成功后，即使首次查询失败也尝试删除。
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

    let (q1, del) = query_then_delete(&inv, &o, &marker).await;
    let del = del.expect("delete call");
    assert!(
        del.result.success,
        "delete failed: {:?}",
        del.result.error()
    );
    let q1 = q1.expect("post-insert query");

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

async fn query_then_delete(
    inv: &SfInvoker,
    org: &str,
    marker: &str,
) -> (
    Result<features::soql::QueryResult, sf_core::SfError>,
    Result<features::anon_apex::AnonApexOutcome, sf_core::SfError>,
) {
    let query = run_query(
        inv,
        &format!("SELECT Id, Name FROM Account WHERE Name = '{marker}'"),
        Some(org),
        QueryOptions::default(),
    )
    .await;
    let cleanup = run_anon(
        inv,
        &format!("delete [SELECT Id FROM Account WHERE Name = '{marker}'];"),
        Some(org),
    )
    .await;
    (query, cleanup)
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
    let temp = TestRoot::new();
    let root = temp.path().to_path_buf();

    let context = features::metadata_context::resolve(&inv, &root, &o)
        .await
        .expect("Resolve org identity / 解析组织身份");
    let api = context.api_version;
    let mut phases: Vec<&'static str> = vec![];
    let ost = features::index::index_org_for_target(
        &inv,
        root.clone(),
        context.binding.cache_key(),
        context.binding.username(),
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
    let (loaded, manifest) = apex_lang::load_snapshot(&root, context.binding.cache_key(), &api)
        .expect("Snapshot reload / 快照重载");
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
    completer.install_index(&context.binding, ost);
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
}

/// Delta sync against a live org with a future watermark = no changed classes,
/// fast, and reconcile drops a fake type while keeping a real one. Seeds a tiny
/// snapshot first (a full index would take minutes).
#[tokio::test]
#[ignore = "hits the live org; run with --ignored"]
async fn e2e_sync_org_noop() {
    let inv = invoker();
    let o = org();
    let temp = TestRoot::new();
    let root = temp.path().to_path_buf();

    let api = features::api_version::api_version_for(&inv, &o).await;
    seed_sync_fixture(&root, &o, &api).unwrap();

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
}

fn seed_sync_fixture(root: &std::path::Path, org: &str, api: &str) -> std::io::Result<()> {
    use apex_lang::symbols::{ApexType, Ost};
    let schemas = ["Account", "ZzzNotARealType"].map(|name| sf_schema::SObjectSchema {
        name: name.to_owned(),
        ..Default::default()
    });
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
        org_id: org.to_owned(),
        api_version: api.to_owned(),
        indexed_at: "2999-01-01T00:00:00Z".into(),
        namespaces: 0,
        classes: 0,
        sobjects: schemas.len(),
        stdlib_error: None,
    };
    let token = apex_lang::snapshot::generation_token(root, org)?;
    apex_lang::snapshot::save_generation(root, &seeded, &m, &schemas, true, Some(&[]), &token)
}

#[test]
fn synthetic_delta_fixture_has_sync_provenance() {
    let temp = TestRoot::new();
    seed_sync_fixture(temp.path(), "synthetic", "60.0").unwrap();
    let loaded = apex_lang::snapshot::load_sync_snapshot(temp.path(), "synthetic", "60.0");
    let loaded = loaded
        .expect("fixture has provenance / 夹具包含来源信息")
        .unwrap();
    assert_eq!(loaded.schemas.len(), 2);
    assert!(loaded.sources.is_empty());
}

#[tokio::test]
async fn synthetic_delta_fixture_reconciles_with_mocked_org() {
    use sf_core::{runner::MockRunner, RawOutput};

    let temp = TestRoot::new();
    seed_sync_fixture(temp.path(), "synthetic", "60.0").unwrap();
    let inv = SfInvoker::new(Arc::new(MockRunner::new(|_, args| {
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--target-org", "synthetic"]));
        let value = if args.iter().any(|arg| arg == "sobject") {
            serde_json::json!(["Account"])
        } else if args
            .iter()
            .any(|arg| arg == "SELECT Name, NamespacePrefix FROM ApexClass")
        {
            serde_json::json!({"done": true, "totalSize": 1, "records": [
                {"Name": "UfE2eFixture", "NamespacePrefix": null}
            ]})
        } else {
            assert!(args
                .iter()
                .any(|arg| arg.contains("LastModifiedDate > 2999-01-01")));
            serde_json::json!({"done": true, "totalSize": 0, "records": []})
        };
        Ok(RawOutput {
            status: 0,
            stdout: serde_json::json!({"status": 0, "result": value}).to_string(),
            stderr: String::new(),
        })
    })));
    let result = features::index::sync_org(
        &inv,
        temp.path().to_path_buf(),
        "synthetic",
        "60.0",
        &features::index::NamespacePolicy::All,
    )
    .await;
    let (outcome, ost) = result.expect("synthetic sync succeeds / 合成同步成功");
    assert_eq!((outcome.added, outcome.updated, outcome.removed), (0, 0, 1));
    assert!(ost.org_types.iter().any(|ty| ty.name == "Account"));
    assert!(!ost.org_types.iter().any(|ty| ty.name == "ZzzNotARealType"));
}

#[test]
fn live_org_requires_an_explicit_non_default_target() {
    for value in [None, Some(""), Some("   "), Some("default")] {
        assert!(explicit_org(value).is_err());
    }
    assert_eq!(explicit_org(Some(" scratch ")).unwrap(), "scratch");
}

#[test]
fn live_org_cache_roots_are_isolated_and_cleaned_up() {
    let first_path;
    {
        let first = TestRoot::new();
        let second = TestRoot::new();
        assert_ne!(first.path(), second.path());
        first_path = first.path().to_path_buf();
        std::fs::write(first.path().join("synthetic"), "fixture").unwrap();
        assert!(!second.path().join("synthetic").exists());
    }
    assert!(!first_path.exists());
}

#[tokio::test]
async fn dml_cleanup_is_attempted_when_post_insert_query_fails() {
    use sf_core::{runner::MockRunner, RawOutput, SfError};
    use std::sync::atomic::AtomicBool;
    let cleaned = Arc::new(AtomicBool::new(false));
    let observed = Arc::clone(&cleaned);
    let inv = SfInvoker::new(Arc::new(MockRunner::new(move |_, args| {
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--target-org", "synthetic"]));
        if args.first().is_some_and(|arg| arg == "data") {
            return Err(SfError::NotFound);
        }
        let path = args.iter().position(|arg| arg == "-f").unwrap();
        let source = std::fs::read_to_string(&args[path + 1]).unwrap();
        assert_eq!(
            source,
            "delete [SELECT Id FROM Account WHERE Name = 'UF_E2E_123'];"
        );
        observed.store(true, Ordering::SeqCst);
        Ok(RawOutput {
            status: 0,
            stdout: r#"{"status":0,"result":{"compiled":true,"success":true}}"#.into(),
            stderr: String::new(),
        })
    })));
    let (query, cleanup) = query_then_delete(&inv, "synthetic", "UF_E2E_123").await;
    assert!(query.is_err());
    assert!(cleanup.unwrap().result.success);
    assert!(cleaned.load(Ordering::SeqCst));
}
