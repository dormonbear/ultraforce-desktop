use sf_schema::{model::SObjectSchema, sqlite};

#[test]
fn object_fts_tracks_full_delta_delete_and_atomic_rollback() {
    let path = std::env::temp_dir().join(format!("uf-object-fts-{}/index.db", std::process::id()));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
    let mut writer = sqlite::open(&path).unwrap();
    let object = |label: &str| SObjectSchema {
        name: "Empty__c".into(),
        label: label.into(),
        label_plural: "Ledgers".into(),
        ..Default::default()
    };
    sqlite::replace_all_objects(&mut writer, &[object("Customer")]).unwrap();
    assert_eq!(
        sqlite::search_objects(&writer, "Customer*", 10).unwrap(),
        ["Empty__c"]
    );
    let reader = sqlite::open_readonly(&path).unwrap();
    assert!(reader.execute("DELETE FROM objects", []).is_err());
    reader.execute_batch("BEGIN").unwrap();
    assert_eq!(
        sqlite::search_objects(&reader, "Customer*", 10)
            .unwrap()
            .len(),
        1
    );
    sqlite::write_objects(&mut writer, &[object("Supplier")]).unwrap();
    assert_eq!(
        sqlite::search_objects(&reader, "Customer*", 10)
            .unwrap()
            .len(),
        1
    );
    assert!(sqlite::search_objects(&reader, "Supplier*", 10)
        .unwrap()
        .is_empty());
    reader.execute_batch("COMMIT").unwrap();
    assert!(sqlite::search_objects(&reader, "Customer*", 10)
        .unwrap()
        .is_empty());
    assert_eq!(
        sqlite::search_objects(&reader, "Supplier*", 10)
            .unwrap()
            .len(),
        1
    );
    {
        let tx = writer.transaction().unwrap();
        sqlite::upsert_object(&tx, &object("RolledBack")).unwrap();
        // Simulate a failed generation; object identity and FTS both roll back.
    }
    assert!(sqlite::search_objects(&reader, "RolledBack*", 10)
        .unwrap()
        .is_empty());
    assert_eq!(
        sqlite::search_objects(&reader, "Supplier*", 10)
            .unwrap()
            .len(),
        1
    );
    sqlite::delete_object(&writer, "empty__C").unwrap();
    assert!(sqlite::search_objects(&reader, "Supplier*", 10)
        .unwrap()
        .is_empty());
    sqlite::replace_all_objects(&mut writer, &[object("Rebuilt")]).unwrap();
    sqlite::replace_all_objects(&mut writer, &[]).unwrap();
    assert!(sqlite::search_objects(&reader, "Rebuilt*", 10)
        .unwrap()
        .is_empty());
    drop(reader);
    drop(writer);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
