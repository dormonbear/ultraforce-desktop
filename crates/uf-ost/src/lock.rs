//! Root-scoped reindex ownership, independent of generation CAS. / 根目录级重建所有权，与代次 CAS 独立。

use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Read, Seek, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub const RESERVATION_ENV: &str = "UF_OST_REINDEX_RESERVATION";
const COORDINATOR: &str = "reindex.lock";
const LAUNCHER: &str = "reindex-launcher.lock";
const WORKER: &str = "reindex-worker.lock";

#[derive(Serialize, Deserialize)]
struct Owner {
    org: String,
    token: String,
}

fn open(root: &Path, name: &str) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(name))
}

fn claim(file: &File) -> io::Result<bool> {
    match file.try_lock() {
        Ok(()) => Ok(true),
        Err(TryLockError::WouldBlock) => Ok(false),
        Err(TryLockError::Error(e)) => Err(e),
    }
}

fn owner(file: &mut File) -> io::Result<Owner> {
    file.rewind()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    serde_json::from_slice(&bytes).map_err(io::Error::other)
}

fn busy(root: &Path) -> io::Result<bool> {
    // Probe handles close immediately; never unlink a lock inode. / 探测句柄立即关闭；绝不删除锁文件节点。
    for name in [LAUNCHER, WORKER] {
        let file = match OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(name))
        {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        if !claim(&file)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Retained files coordinate only; the OS releases crashed owners. / 保留文件仅用于协调；OS 释放崩溃所有者。
pub struct ReindexLock {
    _lease: File,
    token: String,
}

impl ReindexLock {
    fn acquire_slot(root: &Path, org: &str, slot: &str) -> io::Result<Option<Self>> {
        std::fs::create_dir_all(root)?;
        let mut coordinator = open(root, COORDINATOR)?;
        coordinator.lock()?;
        if busy(root)? {
            return Ok(None);
        }
        let lease = open(root, slot)?;
        if !claim(&lease)? {
            return Ok(None);
        }
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let token = format!(
            "{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let data = serde_json::to_vec(&Owner {
            org: org.into(),
            token: token.clone(),
        })?;
        coordinator.set_len(0)?;
        coordinator.rewind()?;
        coordinator.write_all(&data)?;
        Ok(Some(Self {
            _lease: lease,
            token,
        }))
    }
    pub fn reserve(root: &Path, org: &str) -> io::Result<Option<Self>> {
        Self::acquire_slot(root, org, LAUNCHER)
    }
    pub fn acquire(root: &Path, org: &str) -> io::Result<Option<Self>> {
        Self::acquire_slot(root, org, WORKER)
    }
    pub fn token(&self) -> &str {
        &self.token
    }

    /// Acquire worker ownership while the launcher retains its lease. / 启动器保留租约期间获取工作进程所有权。
    pub fn adopt(root: &Path, org: &str, token: &str) -> io::Result<Self> {
        let mut coordinator = open(root, COORDINATOR)?;
        coordinator.lock()?;
        let current = owner(&mut coordinator)?;
        if current.org != org || current.token != token {
            return Err(io::Error::other(
                "Reindex reservation replaced / 重建预留已替换",
            ));
        }
        let lease = open(root, WORKER)?;
        if !claim(&lease)? {
            return Err(io::Error::other(
                "Reindex worker already owns reservation / 工作进程已持有重建预留",
            ));
        }
        Ok(Self {
            _lease: lease,
            token: token.into(),
        })
    }
}

/// Inspect existing coordination only; offline status never creates files. / 仅检查已有协调文件；离线状态不创建文件。
pub fn is_running(root: &Path, org: &str) -> bool {
    let inspect = || -> io::Result<bool> {
        let mut coordinator = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(COORDINATOR))?;
        coordinator.lock()?;
        Ok(busy(root)? && owner(&mut coordinator)?.org == org)
    };
    inspect().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn root_singleton_handoff_and_stale_files() {
        let root = std::env::temp_dir().join(format!("uf-ost-lock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert!(!is_running(&root, "A"));
        assert!(!root.exists());
        let reservation = ReindexLock::reserve(&root, "A").unwrap().unwrap();
        reservation
            ._lease
            .set_modified(std::time::UNIX_EPOCH)
            .unwrap();
        assert!(is_running(&root, "A"));
        assert!(!is_running(&root, "B"));
        assert!(ReindexLock::acquire(&root, "B").unwrap().is_none());
        let worker = ReindexLock::adopt(&root, "A", reservation.token()).unwrap();
        assert!(ReindexLock::adopt(&root, "A", reservation.token()).is_err());
        let old = reservation.token().to_string();
        drop(reservation);
        assert!(is_running(&root, "A"));
        assert!(ReindexLock::reserve(&root, "B").unwrap().is_none());
        drop(worker);
        assert!(!is_running(&root, "A"));
        let next = ReindexLock::reserve(&root, "B").unwrap().unwrap();
        assert!(ReindexLock::adopt(&root, "A", &old).is_err());
        drop(next);
        assert!(ReindexLock::acquire(&root, "A").unwrap().is_some());
        std::fs::remove_dir_all(root).unwrap();
    }
}
