use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "identity-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::SeqCst)
    ))
}

fn identity(id: &str, username: &str) -> OrgIdentity {
    OrgIdentity {
        id: id.into(),
        username: username.into(),
        alias: None,
        api_version: None,
    }
}

fn bind(root: &Path, target: &str, id: &str, username: &str) -> CacheBinding {
    begin_resolution(root, target)
        .unwrap()
        .complete(&identity(id, username))
        .unwrap()
}

#[test]
fn id_forms_share_context_but_case_sensitive_15_character_ids_remain_distinct() {
    assert_eq!(
        canonical_org_id("00D3000000D8cuI").as_deref(),
        Some("00D3000000D8cuIEAR")
    );
    assert_eq!(
        canonical_org_id("00d3000000d8cuiear").as_deref(),
        Some("00D3000000D8cuIEAR")
    );
    assert_ne!(
        canonical_org_id("00D3000000D8cuI"),
        canonical_org_id("00D3000000d8cui")
    );
    for id in [
        "",
        "../outside",
        "0013000000D8cuIEAR",
        "00D000000000001AAA",
        "00D000000000001999",
        "00D000000000001EAB",
    ] {
        assert_eq!(canonical_org_id(id), None);
    }
    let root = root();
    let first = bind(
        &root,
        "alias/合成",
        "00D3000000D8cuI",
        "synthetic@example.invalid",
    );
    let second = bind(
        &root,
        "second",
        "00d3000000d8cuiear",
        "synthetic@example.invalid",
    );
    assert_eq!(first, second);
    assert_eq!(
        lookup(&root, "synthetic@example.invalid").unwrap(),
        Some(first.clone())
    );
    assert_eq!(lookup(&root, "alias/合成").unwrap(), Some(first));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn users_orgs_and_explicit_roots_are_isolated() {
    let root = root();
    let first = bind(&root, "first", "00D000000000001", "first@example.invalid");
    let second = bind(&root, "second", "00D000000000001", "second@example.invalid");
    let third = bind(&root, "third", "00D000000000002", "first@example.invalid");
    assert_ne!(first.cache_key(), second.cache_key());
    assert_ne!(first.cache_key(), third.cache_key());
    let elsewhere = root.join("other-root");
    assert_eq!(lookup(&elsewhere, "first").unwrap(), None);
    assert!(!elsewhere.exists());
    let other = bind(
        &elsewhere,
        "first",
        "00D000000000001",
        "first@example.invalid",
    );
    assert_ne!(first.cache_key(), other.cache_key());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn later_resolution_cannot_be_overwritten_by_older_completion() {
    let root = root();
    let previous = bind(&root, "moving", "00D000000000001", "old@example.invalid");
    let old = begin_resolution(&root, "moving").unwrap();
    let new = begin_resolution(&root, "moving").unwrap();
    assert_eq!(lookup(&root, "moving").unwrap(), Some(previous.clone()));
    let current = new
        .complete(&identity("00D000000000002", "new@example.invalid"))
        .unwrap();
    assert_eq!(
        old.complete(&identity("00D000000000001", "old@example.invalid"))
            .unwrap(),
        previous
    );
    assert_eq!(lookup(&root, "moving").unwrap(), Some(current));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_and_pending_discovery_never_fabricate_or_replace_a_verified_binding() {
    let root = root();
    let previous = bind(&root, "moving", "00D000000000001", "old@example.invalid");
    let old = begin_resolution(&root, "moving").unwrap();
    let latest = begin_resolution(&root, "moving").unwrap();
    old.complete(&identity("00D000000000002", "other@example.invalid"))
        .unwrap();
    assert_eq!(lookup(&root, "moving").unwrap(), Some(previous.clone()));
    assert!(latest
        .complete(&identity("invalid", "SYNTHETIC_SECRET"))
        .is_err());
    assert_eq!(lookup(&root, "moving").unwrap(), Some(previous));
    let unknown = begin_resolution(&root, "unknown").unwrap();
    assert_eq!(lookup(&root, "unknown").unwrap(), None);
    drop(unknown);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn offline_reads_ignore_legacy_paths_and_do_not_change_catalog_bytes_or_inventory() {
    let root = root();
    assert_eq!(lookup(&root, "../outside").unwrap(), None);
    assert!(!root.exists());
    std::fs::create_dir_all(root.join("legacy")).unwrap();
    std::fs::write(root.join("legacy/index.db"), b"SYNTHETIC_LEGACY").unwrap();
    assert_eq!(lookup(&root, "legacy").unwrap(), None);
    let binding = bind(
        &root,
        "../outside/合成",
        "00D000000000001",
        "synthetic/用户@example.invalid",
    );
    let path = catalog_path(&root);
    let before = std::fs::read(&path).unwrap();
    assert_eq!(lookup(&root, "../outside/合成").unwrap(), Some(binding));
    assert_eq!(lookup(&root, "missing").unwrap(), None);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        1
    );
    assert_eq!(
        std::fs::read(root.join("legacy/index.db")).unwrap(),
        b"SYNTHETIC_LEGACY"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn malformed_catalog_keys_fail_closed_without_echoing_values() {
    let root = root();
    bind(
        &root,
        "alias",
        "00D000000000001",
        "synthetic@example.invalid",
    );
    let conn = Connection::open(catalog_path(&root)).unwrap();
    conn.pragma_update(None, "foreign_keys", false).unwrap();
    conn.execute("UPDATE contexts SET cache_key='../../SYNTHETIC_SECRET'", [])
        .unwrap();
    conn.execute("UPDATE bindings SET cache_key='../../SYNTHETIC_SECRET'", [])
        .unwrap();
    drop(conn);
    let error = lookup(&root, "alias").unwrap_err().to_string();
    assert!(!error.contains("SYNTHETIC_SECRET"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_identity_is_rejected_and_unneeded_display_fields_are_not_persisted() {
    let root = root();
    for target in ["", " \t", "synthetic\0alias", "synthetic\nalias"] {
        assert!(begin_resolution(&root, target).is_err());
    }
    assert!(!root.exists());
    for username in [
        "",
        " \t",
        "synthetic\0@example.invalid",
        "synthetic\n@example.invalid",
    ] {
        let result = begin_resolution(&root, "invalid")
            .unwrap()
            .complete(&identity("00D000000000001", username));
        assert!(result.is_err());
        assert_eq!(lookup(&root, "invalid").unwrap(), None);
    }
    let mut identity = identity("00D000000000001", "synthetic@example.invalid");
    identity.alias = Some("SYNTHETIC_UNUSED_ALIAS".into());
    identity.api_version = Some("SYNTHETIC_UNUSED_API".into());
    begin_resolution(&root, "alias")
        .unwrap()
        .complete(&identity)
        .unwrap();
    let bytes = std::fs::read(catalog_path(&root)).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    assert!(!text.contains("SYNTHETIC_UNUSED"));
    let conn = Connection::open(catalog_path(&root)).unwrap();
    let count: i64 = conn
        .query_row("SELECT count(*) FROM contexts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_writers_deduplicate_one_context() {
    let root = root();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let threads: Vec<_> = (0..4)
        .map(|index| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                bind(
                    &root,
                    &format!("alias-{index}"),
                    "00D000000000001",
                    "synthetic@example.invalid",
                )
            })
        })
        .collect();
    let bindings: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert!(bindings.iter().all(|binding| binding == &bindings[0]));
    std::fs::remove_dir_all(root).unwrap();
}
