//! Cross-org cache for the Apex standard library.
//!
//! For a given API version the Tooling `completions` payload is platform
//! standard library, not org schema — the same ~18 MB for every org. Keying it
//! under each org's `index.db` made every newly added org re-download it, so it
//! is also cached once per API version at `<root>/_shared/stdlib/<api>/`.
//!
//! Org `SymbolTable` and sObject describes stay per-org and never come here.
//! The shared payload lives in completions.db/raw_cache; legacy JSON is ignored.
//! 共享响应存储于 completions.db 的 raw_cache 表；忽略旧 JSON 文件。

use serde_json::Value;
use std::path::{Path, PathBuf};
/// Shared SQLite cache, separated by API version. Legacy JSON is ignored.
/// 按 API 版本隔离的共享 SQLite 缓存；忽略旧 JSON 文件。
pub fn path(root: &Path, api_version: &str) -> PathBuf {
    root.join("_shared")
        .join("stdlib")
        .join(crate::store::sanitize(api_version))
        .join("completions.db")
}

/// Whether a raw payload is worth sharing: some orgs answer the completions
/// endpoint with an empty or error-shaped body (managed-package Tooling
/// failures), and one of those must never poison every other org's cache.
///
/// Equivalent to `!parse_stdlib(raw).is_empty()` but without walking the whole
/// 18 MB payload — see the test that pins the two together.
pub fn is_usable(raw: &Value) -> bool {
    raw.get("publicDeclarations")
        .and_then(Value::as_object)
        .is_some_and(|namespaces| !namespaces.is_empty())
}

/// Read without creating files; missing or corrupt data falls through to live fetch.
/// 读取时不创建文件；缺失或损坏的数据回退至实时获取。
pub fn read(root: &Path, api_version: &str) -> Option<Value> {
    let conn = sf_schema::sqlite::open_readonly(&path(root, api_version)).ok()?;
    let body = crate::db::read_raw(&conn, api_version, "stdlib").ok()??;
    let raw = serde_json::from_str(&body).ok()?;
    is_usable(&raw).then_some(raw)
}

/// Publish one raw_cache row atomically in WAL mode, without generation tables.
/// Best-effort: failed writes leave callers free to use their live response.
/// 以 WAL 模式原子发布一条 raw_cache 记录，不初始化代际表。
/// 尽力缓存：写入失败时调用方仍可使用实时响应。
pub fn write(root: &Path, api_version: &str, raw: &Value) -> std::io::Result<()> {
    let body = serde_json::to_string(raw)?;
    let conn =
        crate::store::open_raw_cache(&path(root, api_version)).map_err(std::io::Error::other)?;
    crate::db::write_raw(&conn, api_version, "stdlib", &body).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::{is_usable, path, read, write};
    use crate::acquire::parse_stdlib;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static SEQ: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "shared-stdlib-test-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn usable_agrees_with_parse_stdlib() {
        // The cheap check exists only to avoid parsing 18 MB twice; if it ever
        // disagrees with the real parser, the shared cache admits garbage.
        let cases = [
            json!({"publicDeclarations": {"System": {"String": {}}}}),
            json!({"publicDeclarations": {}}),
            json!({"publicDeclarations": null}),
            json!({"message": "INVALID_SESSION_ID"}),
            json!({}),
        ];
        for raw in cases {
            assert_eq!(
                is_usable(&raw),
                !parse_stdlib(&raw).is_empty(),
                "disagreement on {raw}"
            );
        }
    }

    #[test]
    fn a_written_payload_reads_back() {
        let root = unique_root();
        let raw = json!({"publicDeclarations": {"System": {"String": {}}}});
        write(&root, "60.0", &raw).unwrap();

        assert_eq!(read(&root, "60.0").unwrap(), raw);
        let conn = sf_schema::sqlite::open_readonly(&path(&root, "60.0")).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(
            crate::db::read_raw(&conn, "60.0", "stdlib").unwrap(),
            Some(raw.to_string())
        );
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tables, ["raw_cache"]);
        drop(conn);
        assert!(!path(&root, "60.0")
            .with_file_name("completions.json")
            .exists());
        // Keyed by api version: another version is a miss, not a stale hit.
        assert!(read(&root, "61.0").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn legacy_json_is_ignored_without_creating_a_database() {
        let root = unique_root();
        let dest = path(&root, "60.0");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let legacy = dest.with_file_name("completions.json");
        let body = r#"{"publicDeclarations":{"System":{"String":{}}}}"#;
        std::fs::write(&legacy, body).unwrap();
        assert!(read(&root, "60.0").is_none());
        assert!(!dest.with_file_name("completions.db").exists());
        assert_eq!(std::fs::read_to_string(legacy).unwrap(), body);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn readers_see_only_committed_usable_payloads() {
        let root = unique_root();
        let old = json!({"publicDeclarations": {"System": {"String": {}}}});
        let new = json!({"publicDeclarations": {"System": {"Integer": {}}}});
        write(&root, "60.0", &old).unwrap();
        let mut conn = crate::store::open_raw_cache(&path(&root, "60.0")).unwrap();
        let tx = conn.transaction().unwrap();
        crate::db::write_raw(&tx, "60.0", "stdlib", &new.to_string()).unwrap();
        assert_eq!(read(&root, "60.0"), Some(old));
        tx.commit().unwrap();
        assert_eq!(read(&root, "60.0"), Some(new));
        crate::db::write_raw(&conn, "60.0", "stdlib", "{}").unwrap();
        assert!(read(&root, "60.0").is_none());
        drop(conn);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn no_temp_file_survives_a_write() {
        let root = unique_root();
        write(&root, "60.0", &json!({"publicDeclarations": {}})).unwrap();

        let dir = path(&root, "60.0").parent().unwrap().to_path_buf();
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn concurrent_writers_leave_one_intact_payload() {
        let root = unique_root();
        let start = std::sync::Arc::new(std::sync::Barrier::new(4));
        // Concurrent connections must publish complete rows of different sizes.
        // 并发连接必须发布大小不同但完整的缓存行。
        let writers: Vec<_> = (0..4)
            .map(|n| {
                let root = root.clone();
                let start = start.clone();
                std::thread::spawn(move || {
                    let types: serde_json::Map<_, _> = (0..n * 50)
                        .map(|i| (format!("Type{i}"), json!({})))
                        .collect();
                    start.wait();
                    write(
                        &root,
                        "60.0",
                        &json!({"publicDeclarations": {"System": types}}),
                    )
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap().unwrap();
        }

        let value = read(&root, "60.0").expect("a whole payload, not a spliced one");
        assert!(value.get("publicDeclarations").is_some());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_corrupt_file_reads_as_a_miss() {
        let root = unique_root();
        let dest = path(&root, "60.0");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        // An invalid database is a cache miss. / 无效数据库视为缓存未命中。
        std::fs::write(&dest, r#"{"publicDeclarations": {"Sys"#).unwrap();

        assert!(read(&root, "60.0").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
