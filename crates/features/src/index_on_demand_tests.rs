use super::*;
use sf_core::{runner::MockRunner, RawOutput};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const KEY: &str = "context-on-demand";
const API: &str = "60.0";

fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "on-demand-publication-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::SeqCst)
    ))
}

fn schema(name: &str, label: &str) -> sf_schema::SObjectSchema {
    sf_schema::SObjectSchema {
        name: name.into(),
        label: label.into(),
        ..Default::default()
    }
}

fn publish(root: &std::path::Path, schemas: &[sf_schema::SObjectSchema]) {
    try_publish(root, schemas).unwrap();
}

fn try_publish(
    root: &std::path::Path,
    schemas: &[sf_schema::SObjectSchema],
) -> std::io::Result<()> {
    let token = apex_lang::snapshot::generation_token(root, KEY)?;
    let ost = Ost {
        namespaces: Vec::new(),
        org_types: schemas.iter().map(schema_to_apex_type).collect(),
    };
    let manifest = IndexManifest {
        org_id: KEY.into(),
        api_version: API.into(),
        indexed_at: "2026-10-21T00:00:00Z".into(),
        namespaces: 0,
        classes: 0,
        sobjects: schemas.len(),
        stdlib_error: None,
    };
    apex_lang::snapshot::save_generation(root, &ost, &manifest, schemas, true, Some(&[]), &token)
}

#[tokio::test]
async fn on_demand_describe_does_not_publish_rows_or_corrupt_snapshot_counts() {
    let root = root();
    publish(&root, &[schema("Account", "Published / 已发布")]);
    let calls = Arc::new(AtomicU64::new(0));
    let captured = calls.clone();
    let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, _| {
        captured.fetch_add(1, Ordering::SeqCst);
        Ok(RawOutput {
            status: 0,
            stdout: serde_json::json!({"status":0,"result":schema("New__c","On demand / 按需")})
                .to_string(),
            stderr: String::new(),
        })
    })));
    let mut store = SchemaStore::for_target(&root, KEY, "synthetic@example.invalid");
    assert_eq!(
        store
            .get_or_fetch(&invoker, API, "New__c")
            .await
            .unwrap()
            .name,
        "New__c"
    );
    {
        let conn =
            sf_schema::sqlite::open_readonly(&sf_schema::sqlite::db_path(&root, KEY)).unwrap();
        assert!(sf_schema::sqlite::read_object(&conn, "New__c")
            .unwrap()
            .is_none());
        let meta = apex_lang::db::read_meta(&conn).unwrap().unwrap();
        assert_eq!((meta.generation, meta.sobjects), (1, 1));
    }
    let mut reopened = SchemaStore::for_target(&root, KEY, "synthetic@example.invalid");
    assert_eq!(
        reopened
            .get_or_fetch(&invoker, API, "New__c")
            .await
            .unwrap()
            .name,
        "New__c"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(reopened.persist_full(&[]).is_err());
    assert!(reopened
        .persist_delta(&[schema("Account", "Wrong / 错误")])
        .is_err());
    assert!(reopened.invalidate(API, "Account").is_err());
    reopened.invalidate(API, "New__c").unwrap();
    reopened
        .get_or_fetch(&invoker, API, "New__c")
        .await
        .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let offline = SfInvoker::new(Arc::new(MockRunner::new(|_, _| Err(SfError::NotFound))));
    {
        let conn = sf_schema::sqlite::open(&sf_schema::sqlite::db_path(&root, KEY)).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_demand_publish BEFORE INSERT ON apex_types BEGIN SELECT RAISE(ABORT,'Synthetic / 合成'); END").unwrap();
        assert!(try_publish(&root, &[schema("Account", "Failed / 失败")]).is_err());
        let mut after_failure = SchemaStore::for_target(&root, KEY, "synthetic@example.invalid");
        assert_eq!(
            after_failure
                .get_or_fetch(&offline, API, "New__c")
                .await
                .unwrap()
                .name,
            "New__c"
        );
        assert_eq!(
            apex_lang::db::read_meta(&conn).unwrap().unwrap().generation,
            1
        );
        conn.execute_batch("DROP TRIGGER reject_demand_publish")
            .unwrap();
    }
    publish(&root, &[schema("Account", "Next generation / 下一代次")]);
    {
        let conn =
            sf_schema::sqlite::open_readonly(&sf_schema::sqlite::db_path(&root, KEY)).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM schema_demand_cache", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    let mut next = SchemaStore::for_target(&root, KEY, "synthetic@example.invalid");
    assert!(reopened
        .get_or_fetch(&offline, API, "New__c")
        .await
        .is_err());
    assert!(next.get_or_fetch(&offline, API, "New__c").await.is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn slow_on_demand_describe_cannot_overwrite_a_newer_published_generation() {
    for initialized in [false, true] {
        let root = root();
        if initialized {
            publish(&root, &[schema("Account", "Before / 之前")]);
        }
        let concurrent = root.clone();
        let invoker = SfInvoker::new(Arc::new(MockRunner::new(move |_, _| {
            publish(
                &concurrent,
                &[
                    schema("Account", "After / 之后"),
                    schema("New__c", "Winner / 胜出"),
                ],
            );
            Ok(RawOutput {
                status: 0,
                stdout: serde_json::json!({"status":0,"result":schema("New__c","Stale / 过时")})
                    .to_string(),
                stderr: String::new(),
            })
        })));
        let mut store = SchemaStore::for_target(&root, KEY, "synthetic@example.invalid");
        let fetched = store.get_or_fetch(&invoker, API, "New__c").await.unwrap();
        assert_eq!(fetched.label, "Winner / 胜出");
        {
            let conn =
                sf_schema::sqlite::open_readonly(&sf_schema::sqlite::db_path(&root, KEY)).unwrap();
            let winner = sf_schema::sqlite::read_object(&conn, "New__c")
                .unwrap()
                .unwrap();
            assert_eq!(winner.label, "Winner / 胜出");
            let meta = apex_lang::db::read_meta(&conn).unwrap().unwrap();
            assert_eq!(
                (meta.generation, meta.sobjects),
                (if initialized { 2 } else { 1 }, 2)
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
