//! Cross-process reindex lock. A per-org `reindex.lock` file marks a full
//! index in progress, making the `ost_reindex` singleton **global** (spec §5:
//! "singleton via a lock row/file") and visible to `ost_status` / `uf-ost
//! status` across processes — an in-memory guard could see neither a
//! cron-spawned indexer nor a second server.

use std::path::{Path, PathBuf};

use sf_schema::sqlite;

/// A crashed indexer must not lock an org out forever; a lock older than this
/// is treated as stale and reclaimed. Reindexes take minutes, not hours.
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(2 * 3_600);

fn lock_path(root: &Path, org: &str) -> PathBuf {
    sqlite::db_path(root, org).with_file_name("reindex.lock")
}

/// Whether a fresh (non-stale) reindex lock is held for `org`.
pub fn is_running(root: &Path, org: &str) -> bool {
    !is_stale(&lock_path(root, org))
        .unwrap_or(true) // no file / unreadable ⇒ not running
        && lock_path(root, org).exists()
}

/// `Some(true)` = file exists and is older than `STALE_AFTER`; `Some(false)` =
/// exists and fresh; `None` = no file.
fn is_stale(path: &Path) -> Option<bool> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.elapsed().map(|e| e > STALE_AFTER).unwrap_or(false))
}

/// RAII reindex lock, created `O_EXCL` so at most one holder exists per org.
/// Removed on drop (or reclaimed if a previous holder left it stale).
pub struct ReindexLock {
    path: PathBuf,
}

impl ReindexLock {
    /// Try to claim the reindex lock for `org`. `Ok(None)` when another live
    /// reindex already holds it; a stale lock is reclaimed.
    pub fn acquire(root: &Path, org: &str) -> std::io::Result<Option<ReindexLock>> {
        let path = lock_path(root, org);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if is_stale(&path) == Some(true) {
            let _ = std::fs::remove_file(&path);
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => Ok(Some(ReindexLock { path })),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
            Err(e) => Err(e),
        }
    }
}

impl Drop for ReindexLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn singleton_lock_is_exclusive_and_released_on_drop() {
        let root = std::env::temp_dir().join(format!("uf-ost-lock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        assert!(!is_running(&root, "A"));
        let g = ReindexLock::acquire(&root, "A")
            .unwrap()
            .expect("first claim");
        assert!(is_running(&root, "A"), "lock visible while held");
        assert!(
            ReindexLock::acquire(&root, "A").unwrap().is_none(),
            "second claim blocked"
        );
        // A different org is independent.
        assert!(ReindexLock::acquire(&root, "B").unwrap().is_some());

        drop(g);
        assert!(!is_running(&root, "A"), "released on drop");
        assert!(
            ReindexLock::acquire(&root, "A").unwrap().is_some(),
            "reclaimable"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
