//! Root-local org/user bindings; credentials never enter this catalog.
//! 根目录内的组织/用户绑定；凭据不会进入此目录数据库。

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sf_core::OrgIdentity;
use std::path::{Path, PathBuf};
use std::time::Duration;

const INVALID: &str = "Invalid metadata identity binding / 无效的元数据身份绑定";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CacheBinding {
    org_id: String,
    username: String,
    cache_key: String,
}

impl CacheBinding {
    pub fn org_id(&self) -> &str {
        &self.org_id
    }
    pub fn username(&self) -> &str {
        &self.username
    }
    pub fn cache_key(&self) -> &str {
        &self.cache_key
    }
}

/// A resolution order reserved before CLI I/O. / CLI I/O 前预留的解析顺序。
pub struct Resolution {
    root: PathBuf,
    target: String,
    sequence: i64,
}

fn invalid() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, INVALID)
}

fn db_error(error: rusqlite::Error) -> std::io::Error {
    std::io::Error::other(error)
}

fn usable_target(target: &str) -> bool {
    !target.trim().is_empty() && !target.chars().any(char::is_control)
}

fn catalog_path(root: &Path) -> PathBuf {
    root.join("_identity").join("bindings.db")
}

/// Canonical case-safe org ID; 18-character suffix bits restore letter casing.
/// 规范化的大小写安全组织 ID；18 位后缀的位标记用于恢复字母大小写。
fn canonical_org_id(id: &str) -> Option<String> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    if !matches!(id.len(), 15 | 18) || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return None;
    }
    let mut base = id.as_bytes()[..15].to_vec();
    if id.len() == 18 {
        for (block, suffix) in id.as_bytes()[15..].iter().enumerate() {
            let mask = ALPHABET
                .iter()
                .position(|byte| *byte == suffix.to_ascii_uppercase())?;
            for (position, byte) in base[block * 5..block * 5 + 5].iter_mut().enumerate() {
                if mask & (1 << position) != 0 {
                    if !byte.is_ascii_alphabetic() {
                        return None;
                    }
                    *byte = byte.to_ascii_uppercase();
                } else {
                    *byte = byte.to_ascii_lowercase();
                }
            }
        }
    }
    if !base.starts_with(b"00D") {
        return None;
    }
    let mut result = String::from_utf8(base.clone()).ok()?;
    for block in base.as_chunks::<5>().0 {
        let mask = block.iter().enumerate().fold(0, |mask, (position, byte)| {
            mask | (usize::from(byte.is_ascii_uppercase()) << position)
        });
        result.push(char::from(ALPHABET[mask]));
    }
    Some(result)
}

fn validate(binding: CacheBinding) -> std::io::Result<CacheBinding> {
    if canonical_org_id(&binding.org_id).as_deref() != Some(binding.org_id.as_str())
        || !usable_target(&binding.username)
        || binding.cache_key.len() != 36
        || !binding.cache_key.starts_with("org-")
        || !binding.cache_key.as_bytes()[4..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(invalid());
    }
    Ok(binding)
}

fn writer(root: &Path) -> std::io::Result<Connection> {
    let path = catalog_path(root);
    std::fs::create_dir_all(path.parent().ok_or_else(invalid)?)?;
    let conn = Connection::open(path).map_err(db_error)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(db_error)?;
    // DELETE keeps offline catalog reads free of WAL/SHM creation. Snapshot publication remains WAL/CAS.
    // DELETE 避免离线目录读取创建 WAL/SHM 文件；快照发布仍使用 WAL/CAS。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS contexts (
            cache_key TEXT PRIMARY KEY, org_id TEXT NOT NULL, username TEXT NOT NULL,
            UNIQUE(org_id, username)
         );
         CREATE TABLE IF NOT EXISTS bindings (
            target TEXT PRIMARY KEY, requested_sequence INTEGER NOT NULL,
            cache_key TEXT REFERENCES contexts(cache_key)
         );
         CREATE TABLE IF NOT EXISTS resolution_order (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL
         );
         INSERT OR IGNORE INTO resolution_order VALUES (1,0);",
    )
    .map_err(db_error)?;
    Ok(conn)
}

/// Reserve ordering without changing the last verified offline binding.
/// 预留顺序，但不更改最近已验证的离线绑定。
pub fn begin_resolution(root: &Path, target: &str) -> std::io::Result<Resolution> {
    if !usable_target(target) {
        return Err(invalid());
    }
    let mut conn = writer(root)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let sequence: i64 = tx
        .query_row(
            "UPDATE resolution_order SET sequence=sequence+1 WHERE singleton=1 RETURNING sequence",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    tx.execute(
        "INSERT INTO bindings(target,requested_sequence) VALUES (?1,?2)
         ON CONFLICT(target) DO UPDATE SET requested_sequence=excluded.requested_sequence",
        params![target, sequence],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(Resolution {
        root: root.to_owned(),
        target: target.to_owned(),
        sequence,
    })
}

impl Resolution {
    /// Bind once after discovery; publishing a generation must never rebind aliases.
    /// 发现身份后绑定一次；发布代次时不得再次绑定别名。
    pub fn complete(self, identity: &OrgIdentity) -> std::io::Result<CacheBinding> {
        let org_id = canonical_org_id(&identity.id).ok_or_else(invalid)?;
        if !usable_target(&identity.username) {
            return Err(invalid());
        }
        let mut conn = writer(&self.root)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        tx.execute(
            "INSERT INTO contexts(cache_key,org_id,username) VALUES ('org-'||lower(hex(randomblob(16))),?1,?2)
             ON CONFLICT(org_id,username) DO NOTHING",
            params![org_id, identity.username],
        ).map_err(db_error)?;
        let binding = validate(
            tx.query_row(
                "SELECT org_id,username,cache_key FROM contexts WHERE org_id=?1 AND username=?2",
                params![org_id, identity.username],
                read_binding,
            )
            .map_err(db_error)?,
        )?;
        for target in [&self.target, &identity.username] {
            tx.execute(
                "INSERT INTO bindings(target,requested_sequence,cache_key) VALUES (?1,?2,?3)
                 ON CONFLICT(target) DO UPDATE SET cache_key=excluded.cache_key,
                    requested_sequence=excluded.requested_sequence
                 WHERE bindings.requested_sequence<=excluded.requested_sequence",
                params![target, self.sequence, binding.cache_key],
            )
            .map_err(db_error)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(binding)
    }
}

fn read_binding(row: &rusqlite::Row<'_>) -> rusqlite::Result<CacheBinding> {
    Ok(CacheBinding {
        org_id: row.get(0)?,
        username: row.get(1)?,
        cache_key: row.get(2)?,
    })
}

/// Resolve only a previously verified local binding; never creates files or calls CLI.
/// 仅解析先前验证的本地绑定；不创建文件，也不调用 CLI。
pub fn lookup(root: &Path, target: &str) -> std::io::Result<Option<CacheBinding>> {
    let path = catalog_path(root);
    if !path.exists() {
        return Ok(None);
    }
    let conn = crate::sqlite::open_readonly(&path).map_err(db_error)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    let binding = conn
        .query_row(
            "SELECT c.org_id,c.username,c.cache_key FROM bindings b
         JOIN contexts c ON c.cache_key=b.cache_key WHERE b.target=?1",
            [target],
            read_binding,
        )
        .optional()
        .map_err(db_error)?;
    binding.map(validate).transpose()
}

/// One usable target per verified context, preferring its username over aliases.
/// 每个已验证上下文返回一个可用目标，优先采用用户名。
pub fn known_contexts(root: &Path) -> std::io::Result<Vec<(String, CacheBinding)>> {
    let path = catalog_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let conn = crate::sqlite::open_readonly(&path).map_err(db_error)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    let mut statement = conn
        .prepare(
            "SELECT c.org_id,c.username,c.cache_key,
            COALESCE(MAX(CASE WHEN b.target=c.username THEN b.target END),MIN(b.target))
         FROM contexts c JOIN bindings b ON b.cache_key=c.cache_key
         GROUP BY c.cache_key ORDER BY 4",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(3)?, read_binding(row)?)))
        .map_err(db_error)?;
    rows.map(|row| {
        let (target, binding) = row.map_err(db_error)?;
        if !usable_target(&target) {
            return Err(invalid());
        }
        Ok((target, validate(binding)?))
    })
    .collect()
}

#[cfg(test)]
#[path = "identity_tests.rs"]
mod tests;
