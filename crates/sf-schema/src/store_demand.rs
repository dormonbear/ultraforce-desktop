//! Generation-scoped auxiliary describes; published rows belong to the indexer.
//! 按代次限定的辅助 describe 缓存；已发布行归索引器管理。

use crate::{sqlite, SObjectSchema};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{io, path::Path};

fn error(error: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> io::Error {
    io::Error::other(error)
}

pub(super) fn has_table(conn: &Connection, name: &str) -> io::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |row| row.get(0),
    )
    .map_err(error)
}

pub(super) fn generation(conn: &Connection, key: &str) -> io::Result<Option<i64>> {
    if !has_table(conn, "meta")? {
        return Ok(None);
    }
    let meta: Option<(String, String, i64)> = conn
        .query_row(
            "SELECT alias,org_id,generation FROM meta WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(error)?;
    match meta {
        None => Ok(None),
        Some((alias, org_id, generation))
            if alias == key && org_id == key && generation > 0 =>
        {
            Ok(Some(generation))
        }
        _ => Err(io::Error::other(
            "Schema generation identity mismatch; rebuild this org / schema 代次身份不匹配，请重建此组织",
        )),
    }
}

pub(super) fn current(path: &Path, key: &str) -> io::Result<Option<i64>> {
    if !path.exists() {
        return Ok(None);
    }
    let conn = sqlite::open_readonly(path).map_err(error)?;
    generation(&conn, key)
}

pub(super) fn load(
    conn: &Connection,
    api: &str,
    object: &str,
    generation: Option<i64>,
) -> io::Result<Option<SObjectSchema>> {
    let Some(generation) = generation else {
        return Ok(None);
    };
    if !has_table(conn, "schema_demand_cache")? {
        return Ok(None);
    }
    let body: Option<String> = conn
        .query_row(
            "SELECT body FROM schema_demand_cache WHERE api_version=?1 AND name=?2 AND base_generation=?3",
            params![api, object.to_ascii_lowercase(), generation],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    Ok(body
        .and_then(|body| serde_json::from_str::<SObjectSchema>(&body).ok())
        .filter(|schema| schema.name.eq_ignore_ascii_case(object)))
}

/// Compare under a writer transaction; stale acquisitions leave the winner intact.
/// 在写事务内比较代次；过时取数不会改变胜出的代次。
pub(super) fn save(
    path: &Path,
    key: &str,
    api: &str,
    schema: &SObjectSchema,
    expected: Option<i64>,
) -> io::Result<bool> {
    let mut conn = sqlite::open_without_schema(path).map_err(error)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let current = generation(&tx, key)?;
    if current != expected {
        return Ok(false);
    }
    if let Some(generation) = current {
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_demand_cache (
            api_version TEXT NOT NULL, name TEXT NOT NULL, base_generation INTEGER NOT NULL,
            body TEXT NOT NULL, PRIMARY KEY(api_version,name));",
        )
        .map_err(error)?;
        let body = serde_json::to_string(schema).map_err(error)?;
        tx.execute("INSERT INTO schema_demand_cache VALUES (?1,?2,?3,?4)
            ON CONFLICT(api_version,name) DO UPDATE SET base_generation=excluded.base_generation,body=excluded.body",
            params![api,schema.name.to_ascii_lowercase(),generation,body]).map_err(error)?;
    } else {
        // Unpublished stores keep their existing typed-cache behavior. / 未发布的存储保留既有类型缓存行为。
        sqlite::ensure_object_schema(&tx).map_err(error)?;
        sqlite::upsert_object(&tx, schema).map_err(error)?;
    }
    tx.commit().map_err(error)?;
    Ok(true)
}

fn published_write_error() -> io::Error {
    io::Error::other("Published schema changes require index/sync publication / 已发布 schema 的变更须通过索引或同步发布")
}

pub(super) fn write_unpublished(
    path: &Path,
    key: &str,
    schemas: &[SObjectSchema],
    full: bool,
) -> io::Result<()> {
    let mut conn = sqlite::open_without_schema(path).map_err(error)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    if generation(&tx, key)?.is_some() {
        return Err(published_write_error());
    }
    if full {
        sqlite::replace_objects_in_transaction(&tx, schemas).map_err(error)?;
    } else {
        sqlite::ensure_object_schema(&tx).map_err(error)?;
        for schema in schemas {
            sqlite::upsert_object(&tx, schema).map_err(error)?;
        }
    }
    tx.commit().map_err(error)
}

pub(super) fn invalidate(path: &Path, key: &str, api: &str, object: &str) -> io::Result<()> {
    let mut conn = sqlite::open_without_schema(path).map_err(error)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    if generation(&tx, key)?.is_some() {
        if sqlite::read_object(&tx, object).map_err(error)?.is_some() {
            return Err(published_write_error());
        }
        if has_table(&tx, "schema_demand_cache")? {
            tx.execute(
                "DELETE FROM schema_demand_cache WHERE api_version=?1 AND name=?2",
                params![api, object.to_ascii_lowercase()],
            )
            .map_err(error)?;
        }
    } else {
        sqlite::ensure_object_schema(&tx).map_err(error)?;
        sqlite::delete_object(&tx, object).map_err(error)?;
    }
    tx.commit().map_err(error)
}
