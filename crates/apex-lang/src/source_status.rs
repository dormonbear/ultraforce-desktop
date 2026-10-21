//! Small, transaction-owned availability projection of canonical source JSON.
//! 规范来源 JSON 的轻量可用性投影，由同一事务维护。
use rusqlite::{params, Connection};
use serde_json::Value;

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceStatus {
    pub namespace: String,
    pub name: String,
    pub available: bool,
}

pub fn expected(records: &[Value]) -> std::io::Result<Vec<SourceStatus>> {
    let bad =
        || std::io::Error::other("invalid source availability provenance; full reindex required");
    let mut rows = Vec::new();
    for record in records {
        let name = record
            .get("Name")
            .and_then(Value::as_str)
            .filter(|n| !n.is_empty())
            .ok_or_else(bad)?;
        let namespace = match record.get("NamespacePrefix") {
            Some(Value::Null) => "",
            Some(Value::String(n)) => n,
            _ => return Err(bad()),
        };
        let table = record.get("SymbolTable").ok_or_else(bad)?;
        if !table.is_null() && !table.is_object() {
            return Err(bad());
        }
        rows.push(SourceStatus {
            namespace: namespace.to_ascii_lowercase(),
            name: name.to_ascii_lowercase(),
            available: table.is_object(),
        });
    }
    rows.sort();
    if rows
        .windows(2)
        .any(|pair| pair[0].namespace == pair[1].namespace && pair[0].name == pair[1].name)
    {
        return Err(bad());
    }
    Ok(rows)
}

pub fn replace(conn: &Connection, records: &[Value]) -> std::io::Result<()> {
    let rows = expected(records)?;
    conn.execute("DELETE FROM apex_source_status", [])
        .map_err(std::io::Error::other)?;
    for row in rows {
        conn.execute(
            "INSERT INTO apex_source_status(namespace,name,available) VALUES(?1,?2,?3)",
            params![row.namespace, row.name, row.available],
        )
        .map_err(std::io::Error::other)?;
    }
    Ok(())
}

pub fn read(conn: &Connection) -> rusqlite::Result<Vec<SourceStatus>> {
    let mut stmt = conn.prepare(
        "SELECT namespace,name,available FROM apex_source_status ORDER BY namespace,name",
    )?;
    let rows = stmt.query_map([], |row| {
        let flag: i64 = row.get(2)?;
        if flag != 0 && flag != 1 {
            return Err(rusqlite::Error::IntegralValueOutOfRange(2, flag));
        }
        Ok(SourceStatus {
            namespace: row.get(0)?,
            name: row.get(1)?,
            available: flag == 1,
        })
    })?;
    rows.collect()
}

/// Cheap publication-shape checks. Complete canonical cross-checking occurs
/// during sync, which already loads the large source JSON. This does not detect
/// arbitrary same-length external edits of the canonical blob on every lookup.
/// 查询执行轻量结构检查；同步加载完整来源时交叉核验，不逐次检测外部任意等长篡改。
pub fn unavailable_count(conn: &Connection, classes: i64) -> rusqlite::Result<Option<i64>> {
    let (sources, total, bad, unavailable): (i64, i64, i64, i64) = conn.query_row(
        "SELECT (SELECT count(*) FROM apex_sources WHERE id=1),count(*),
         coalesce(sum(available NOT IN(0,1) OR name='' OR namespace IS NULL),0),
         coalesce(sum(available=0),0) FROM apex_source_status",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    Ok((sources == 1 && total == classes && bad == 0).then_some(unavailable))
}

pub fn availability(conn: &Connection, name: &str, classes: i64) -> rusqlite::Result<Option<bool>> {
    if unavailable_count(conn, classes)?.is_none() {
        return Ok(None);
    }
    // Bare-name lookup may match more than one namespace. Be conservative:
    // one unavailable matching source prevents claiming availability.
    // 裸名称可能匹配多个命名空间；任一匹配来源不可用时，保守地报告不可用。
    conn.query_row(
        "SELECT min(available) FROM apex_source_status WHERE name=?1 COLLATE NOCASE",
        [name],
        |row| row.get(0),
    )
}
