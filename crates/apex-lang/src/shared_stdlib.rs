//! Cross-org cache for the Apex standard library.
//!
//! For a given API version the Tooling `completions` payload is platform
//! standard library, not org schema — the same ~18 MB for every org. Keying it
//! under each org's `index.db` made every newly added org re-download it, so it
//! is also cached once per API version at `<root>/_shared/stdlib/<api>/`.
//!
//! Org `SymbolTable` and sObject describes stay per-org and never come here.

use serde_json::Value;
use std::path::{Path, PathBuf};

/// `<root>/_shared/stdlib/<api_version>/completions.json`. `_shared` cannot
/// collide with an org directory: those are named after an org id.
pub fn path(root: &Path, api_version: &str) -> PathBuf {
    root.join("_shared")
        .join("stdlib")
        .join(crate::store::sanitize(api_version))
        .join("completions.json")
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

/// Read the shared payload, or `None` when it is absent, unreadable, or not
/// valid JSON. A corrupt file is a cache miss, not an error: the caller falls
/// through to the live fetch and overwrites it.
pub fn read(root: &Path, api_version: &str) -> Option<Value> {
    let body = std::fs::read_to_string(path(root, api_version)).ok()?;
    serde_json::from_str(&body).ok()
}

/// Write the shared payload. Best-effort — a failure here only costs the next
/// org a re-download, so callers ignore the result.
///
/// The write goes to a temp file and is renamed into place: the uf-ost MCP
/// server is a separate process reading the same file, and an 18 MB write
/// straight to the destination would let it read a half-written payload.
pub fn write(root: &Path, api_version: &str, raw: &Value) -> std::io::Result<()> {
    let dest = path(root, api_version);
    let dir = dest
        .parent()
        .ok_or_else(|| std::io::Error::other("shared stdlib path has no parent"))?;
    std::fs::create_dir_all(dir)?;

    // Unique per process so two concurrent writers cannot truncate each other's
    // temp file; both then rename, and the last one wins with intact content.
    let tmp = dir.join(format!("completions.json.{}.tmp", std::process::id()));
    let body = serde_json::to_string(raw)?;
    std::fs::write(&tmp, body)?;
    match std::fs::rename(&tmp, &dest) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
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
        // Keyed by api version: another version is a miss, not a stale hit.
        assert!(read(&root, "61.0").is_none());
        std::fs::remove_dir_all(&root).unwrap();
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
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_corrupt_file_reads_as_a_miss() {
        let root = unique_root();
        let dest = path(&root, "60.0");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        // A half-written payload — what a non-atomic writer would leave.
        std::fs::write(&dest, r#"{"publicDeclarations": {"Sys"#).unwrap();

        assert!(read(&root, "60.0").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
