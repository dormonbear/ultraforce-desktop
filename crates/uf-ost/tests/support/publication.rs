use super::*;

#[tokio::test]
async fn full_list_or_describe_failure_retains_the_previous_generation() {
    let root = std::env::temp_dir().join(format!("uf-ost-full-fetch-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "Synthetic").await;
    let reader =
        sf_schema::sqlite::open_readonly(&sf_schema::sqlite::db_path(&root, "Synthetic")).unwrap();
    let before = apex_lang::db::read_meta(&reader).unwrap().unwrap();
    for fail_list in [true, false] {
        let runner = MockRunner::new(move |_, args: &[String]| {
            let args = args.join(" ");
            let stdout = if args.contains("ApexClass") {
                r#"{"status":0,"result":{"records":[]}}"#
            } else if args.contains("sobject list") && !fail_list {
                r#"{"status":0,"result":["Account"]}"#
            } else {
                return Err(sf_core::SfError::Spawn(std::io::Error::other(
                    "synthetic fetch failure",
                )));
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: stdout.into(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));
        assert!(features::index::index_org(
            &invoker,
            root.clone(),
            "Synthetic",
            "60.0",
            &features::index::NamespacePolicy::All,
            &mut |_| {}
        )
        .await
        .is_err());
        assert_eq!(apex_lang::db::read_meta(&reader).unwrap().unwrap(), before);
        assert!(sf_schema::sqlite::read_object(&reader, "Account")
            .unwrap()
            .is_some());
        assert!(apex_lang::snapshot::read_apex_type(&reader, "Foo")
            .unwrap()
            .is_some());
    }
    drop(reader);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn delta_fetch_and_failed_publish_preserve_the_published_generation() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let root = std::env::temp_dir().join(format!("uf-ost-delta-publish-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "Synthetic").await;
    let path = sf_schema::sqlite::db_path(&root, "Synthetic");
    let writer = apex_lang::db::open_apex(&path).unwrap();
    let before = apex_lang::db::read_meta(&writer).unwrap().unwrap();
    writer.execute_batch("CREATE TRIGGER reject_generation BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT, 'synthetic publication failure'); END;").unwrap();
    let fail_fetch = Arc::new(AtomicBool::new(false));
    let failure = fail_fetch.clone();
    let during_fetch_path = path.clone();
    let runner = MockRunner::new(move |_, args: &[String]| {
        let args = args.join(" ");
        let stdout = if args.contains("ApexClass") {
            r#"{"status":0,"result":{"records":[{"Name":"NewService","SymbolTable":{"name":"NewService","methods":[],"properties":[]}}]}}"#
        } else if args.contains("FROM EntityDefinition") {
            r#"{"status":0,"result":{"records":[{"QualifiedApiName":"Account"}]}}"#
        } else if args.contains("FROM CustomField") {
            r#"{"status":0,"result":{"records":[]}}"#
        } else if args.contains("composite") {
            // Observe the ACTUAL coordinator during fetching, before publication.
            let reader = sf_schema::sqlite::open_readonly(&during_fetch_path).unwrap();
            let schema = sf_schema::sqlite::read_object(&reader, "Account")
                .unwrap()
                .expect("delta fetch must not evict published object");
            assert_eq!(schema.fields[0].field_type, "picklist");
            assert!(apex_lang::snapshot::read_apex_type(&reader, "Foo")
                .unwrap()
                .is_some());
            if failure.load(Ordering::SeqCst) {
                return Err(sf_core::SfError::Spawn(std::io::Error::other(
                    "synthetic describe failure",
                )));
            }
            r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"Account","label":"Updated Ledger","fields":[{"name":"Industry","label":"Updated Sector","type":"string","referenceTo":[]}],"childRelationships":[]}}]}"#
        } else {
            return Err(sf_core::SfError::Spawn(std::io::Error::other(
                "unexpected synthetic command",
            )));
        };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        })
    });
    let invoker = SfInvoker::new(Arc::new(runner));
    let sync = || {
        features::index::sync_org(
            &invoker,
            root.clone(),
            "Synthetic",
            "60.0",
            &features::index::NamespacePolicy::All,
        )
    };
    assert!(sync().await.is_err());
    assert_eq!(apex_lang::db::read_meta(&writer).unwrap().unwrap(), before);
    assert_eq!(
        sf_schema::sqlite::read_object(&writer, "Account")
            .unwrap()
            .unwrap()
            .fields[0]
            .field_type,
        "picklist"
    );
    assert!(apex_lang::snapshot::read_apex_type(&writer, "NewService")
        .unwrap()
        .is_none());
    writer
        .execute_batch("DROP TRIGGER reject_generation")
        .unwrap();
    fail_fetch.store(true, Ordering::SeqCst);
    assert!(
        sync().await.is_err(),
        "incomplete describes cannot advance watermark"
    );
    assert_eq!(apex_lang::db::read_meta(&writer).unwrap().unwrap(), before);
    fail_fetch.store(false, Ordering::SeqCst);
    let old = sf_schema::sqlite::open_readonly(&path).unwrap();
    old.execute_batch("BEGIN").unwrap();
    assert_eq!(apex_lang::db::read_meta(&old).unwrap().unwrap(), before);
    sync().await.unwrap();
    assert_eq!(
        apex_lang::db::read_meta(&writer)
            .unwrap()
            .unwrap()
            .generation,
        before.generation + 1
    );
    assert_eq!(
        sf_schema::sqlite::search_objects(&writer, "Updated*", 25).unwrap(),
        ["Account"]
    );
    assert_eq!(
        sf_schema::sqlite::search_fields(&writer, "Sector*", 25).unwrap()[0].1,
        "Industry"
    );
    assert!(apex_lang::snapshot::read_apex_type(&writer, "NewService")
        .unwrap()
        .is_some());
    assert_eq!(apex_lang::db::read_meta(&old).unwrap().unwrap(), before);
    assert_eq!(
        sf_schema::sqlite::read_object(&old, "Account")
            .unwrap()
            .unwrap()
            .fields[0]
            .field_type,
        "picklist"
    );
    assert!(apex_lang::snapshot::read_apex_type(&old, "NewService")
        .unwrap()
        .is_none());
    drop(old);
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_generation_publication_keeps_previous_schema_and_metadata() {
    let root = std::env::temp_dir().join(format!("uf-ost-publish-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    seed_index(&root, "Synthetic").await;
    let path = sf_schema::sqlite::db_path(&root, "Synthetic");
    let writer = apex_lang::db::open_apex(&path).unwrap();
    writer.execute_batch("CREATE TRIGGER reject_generation BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT, 'synthetic publication failure'); END;").unwrap();
    let before = apex_lang::db::read_meta(&writer).unwrap().unwrap();
    let runner = MockRunner::new(|_, args: &[String]| {
        let args = args.join(" ");
        let stdout = if args.contains("sobject list") {
            r#"{"status":0,"result":["New__c"]}"#
        } else if args.contains("composite") {
            r#"{"compositeResponse":[{"httpStatusCode":200,"referenceId":"r0","body":{"name":"New__c","label":"New Generation","fields":[],"childRelationships":[]}}]}"#
        } else if args.contains("ApexClass") {
            r#"{"status":0,"result":{"records":[{"Name":"NewService","SymbolTable":{"name":"NewService","methods":[],"properties":[]}}]}}"#
        } else {
            r#"{"status":0,"result":[]}"#
        };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: stdout.into(),
            stderr: String::new(),
        })
    });
    let invoker = SfInvoker::new(Arc::new(runner));
    assert!(features::index::index_org(
        &invoker,
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All,
        &mut |_| {}
    )
    .await
    .is_err());
    assert!(
        sf_schema::sqlite::read_object(&writer, "Account")
            .unwrap()
            .is_some(),
        "failed publish must retain old object schema"
    );
    assert!(sf_schema::sqlite::read_object(&writer, "New__c")
        .unwrap()
        .is_none());
    assert_eq!(apex_lang::db::read_meta(&writer).unwrap().unwrap(), before);
    assert!(apex_lang::snapshot::read_apex_type(&writer, "Foo")
        .unwrap()
        .is_some());
    let old_raw = apex_lang::db::read_raw(&writer, "60.0", "org_types")
        .unwrap()
        .unwrap();
    assert!(old_raw.contains("Foo") && !old_raw.contains("NewService"));
    assert!(sf_schema::sqlite::search_objects(&writer, "New*", 25)
        .unwrap()
        .is_empty());
    writer
        .execute_batch("DROP TRIGGER reject_generation")
        .unwrap();
    let old_reader = sf_schema::sqlite::open_readonly(&path).unwrap();
    old_reader.execute_batch("BEGIN").unwrap();
    assert_eq!(
        apex_lang::db::read_meta(&old_reader)
            .unwrap()
            .unwrap()
            .generation,
        before.generation
    );
    features::index::index_org(
        &invoker,
        root.clone(),
        "Synthetic",
        "60.0",
        &features::index::NamespacePolicy::All,
        &mut |_| {},
    )
    .await
    .unwrap();
    assert!(sf_schema::sqlite::read_object(&writer, "New__c")
        .unwrap()
        .is_some());
    assert!(sf_schema::sqlite::read_object(&writer, "Account")
        .unwrap()
        .is_none());
    assert!(apex_lang::snapshot::read_apex_type(&writer, "NewService")
        .unwrap()
        .is_some());
    assert!(apex_lang::snapshot::read_apex_type(&writer, "Foo")
        .unwrap()
        .is_none());
    let new_raw = apex_lang::db::read_raw(&writer, "60.0", "org_types")
        .unwrap()
        .unwrap();
    assert!(new_raw.contains("NewService") && !new_raw.contains("Foo"));
    assert_eq!(
        apex_lang::db::read_meta(&writer)
            .unwrap()
            .unwrap()
            .generation,
        before.generation + 1
    );
    assert!(sf_schema::sqlite::read_object(&old_reader, "Account")
        .unwrap()
        .is_some());
    assert!(apex_lang::snapshot::read_apex_type(&old_reader, "Foo")
        .unwrap()
        .is_some());
    assert_eq!(
        apex_lang::db::read_meta(&old_reader)
            .unwrap()
            .unwrap()
            .generation,
        before.generation
    );
    drop(old_reader);
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
}
