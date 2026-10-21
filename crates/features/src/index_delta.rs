use super::{ensure_complete_describes, now_iso8601, NamespacePolicy, SyncOutcome};
use apex_lang::acquire::{fetch_changed_apex_classes, fetch_changed_entities, parse_org_types};
use apex_lang::{IndexManifest, Ost};
use serde_json::Value;
use sf_core::{SfError, SfInvoker};
use std::{collections::BTreeMap, path::PathBuf};

fn invalid(message: &str) -> SfError {
    SfError::Spawn(std::io::Error::other(message))
}

// Identity is the source record, never a flattened SymbolTable output name.
// 以来源记录作为身份，不使用扁平化 SymbolTable 输出名称。
fn key(record: &Value) -> Result<(String, String), SfError> {
    let name = record
        .get("Name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("invalid Apex source identity; full reindex required"))?;
    let namespace = match record.get("NamespacePrefix") {
        Some(Value::Null) => "",
        Some(Value::String(s)) => s,
        _ => {
            return Err(invalid(
                "invalid Apex namespace identity; full reindex required",
            ))
        }
    };
    Ok((namespace.to_ascii_lowercase(), name.to_ascii_lowercase()))
}

pub(super) fn validate_sources(records: &[Value]) -> Result<(), SfError> {
    let mut seen = std::collections::BTreeSet::new();
    for record in records {
        let identity = key(record)?;
        if !seen.insert(identity.clone()) {
            return Err(invalid(
                "duplicate Apex source identity; retry full reindex",
            ));
        }
        let value = record
            .get("SymbolTable")
            .ok_or_else(|| invalid("Apex SymbolTable missing; previous index retained"))?;
        // Null is Salesforce's supported unavailable-table response. Retain
        // ownership and the parser's name-only fallback, never old members.
        // null 是 Salesforce 支持的不可用响应；保留归属及名称占位，不沿用旧成员。
        if value.is_null() {
            continue;
        }
        let table = value
            .as_object()
            .ok_or_else(|| invalid("Apex SymbolTable malformed; previous index retained"))?;
        if table.get("name").is_some_and(|name| {
            !name.is_null()
                && !name
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(&identity.1))
        }) {
            return Err(invalid(
                "Apex source/SymbolTable identity mismatch; previous index retained",
            ));
        }
        validate_table(&record["SymbolTable"], false)?;
    }
    Ok(())
}

fn validate_table(table: &Value, inner: bool) -> Result<(), SfError> {
    let Some(table) = table.as_object() else {
        return Err(invalid(
            "corrupt nested SymbolTable; previous index retained",
        ));
    };
    if inner
        && !table
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty())
    {
        return Err(invalid(
            "nested SymbolTable identity missing; previous index retained",
        ));
    }
    for field in ["methods", "properties", "innerClasses"] {
        if table.get(field).is_some_and(|v| !v.is_array()) {
            return Err(invalid(
                "corrupt SymbolTable members; previous index retained",
            ));
        }
    }
    if let Some(inner) = table.get("innerClasses").and_then(Value::as_array) {
        for table in inner {
            validate_table(table, true)?;
        }
    }
    Ok(())
}

async fn live_classes(invoker: &SfInvoker, org: &str) -> Result<Vec<(String, String)>, SfError> {
    let mut args = vec![
        "data",
        "query",
        "--query",
        "SELECT Name, NamespacePrefix FROM ApexClass",
        "--use-tooling-api",
    ];
    if org != "default" {
        args.extend(["--target-org", org]);
    }
    let value: Value = invoker.run_json(&args).await?;
    let records = value
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Apex source enumeration incomplete; previous index retained"))?;
    if records.iter().any(|record| {
        !record
            .get("NamespacePrefix")
            .is_some_and(|value| value.is_null() || value.is_string())
    }) {
        return Err(invalid(
            "Apex source enumeration lacks namespace identity; previous index retained",
        ));
    }
    if value.get("done") != Some(&Value::Bool(true))
        || value.get("totalSize").and_then(Value::as_u64) != Some(records.len() as u64)
    {
        return Err(invalid(
            "Apex source enumeration incomplete; previous index retained",
        ));
    }
    let keys: Vec<_> = records.iter().map(key).collect::<Result<_, _>>()?;
    if keys.iter().collect::<std::collections::BTreeSet<_>>().len() != keys.len() {
        return Err(invalid(
            "duplicate Apex source enumeration; previous index retained",
        ));
    }
    Ok(keys)
}

/// Reconcile source records and regenerate their derived graph. No snapshot/API
/// mismatch remains a no-op; stale versions or missing provenance require a full
/// reindex. Counts refer to Apex source records and sObjects, not inner types.
/// 按来源重建派生图；无快照或 API 不匹配时不操作，旧版本或缺失来源须完整重建。
/// 数量统计 Apex 来源记录及对象，不统计展开的内部类型。
pub async fn sync_org(
    invoker: &SfInvoker,
    root: PathBuf,
    org: &str,
    api: &str,
    policy: &NamespacePolicy,
) -> Result<(SyncOutcome, Ost), SfError> {
    let Some(snapshot) =
        apex_lang::snapshot::load_sync_snapshot(&root, org, api).map_err(SfError::Spawn)?
    else {
        return Ok((SyncOutcome::default(), Ost::default()));
    };
    validate_sources(&snapshot.sources)?;
    if apex_lang::source_status::expected(&snapshot.sources).map_err(SfError::Spawn)?
        != snapshot.source_status
    {
        return Err(invalid(
            "index availability provenance mismatch; full reindex required",
        ));
    }
    if snapshot.sources.len() != snapshot.manifest.classes
        || snapshot.schemas.len() != snapshot.manifest.sobjects
    {
        return Err(invalid(
            "index provenance counts mismatch; full reindex required",
        ));
    }
    let started_at = now_iso8601();
    let changed = fetch_changed_apex_classes(invoker, org, &snapshot.manifest.indexed_at).await?;
    validate_sources(&changed)?;
    let entities: Vec<_> = fetch_changed_entities(invoker, org, &snapshot.manifest.indexed_at)
        .await?
        .into_iter()
        .filter(|name| policy.permits(name))
        .collect();
    let mut store = sf_schema::SchemaStore::new(root.clone(), org);
    let schemas: Vec<_> = store
        .fetch_many(invoker, api, &entities, &mut |_, _| {})
        .await
        .into_iter()
        .map(|(_, schema)| schema)
        .collect();
    ensure_complete_describes(&entities, &schemas)?;
    // Complete authoritative lists gate BOTH deletion families. Fetch errors
    // abort publication; empty lists allow upserts but cannot erase old data.
    // 两类删除均须完整权威列表；获取失败则中止发布，空列表仅允许更新而不能删除。
    let live: std::collections::BTreeSet<_> =
        live_classes(invoker, org).await?.into_iter().collect();
    let mut args = vec!["sobject", "list", "--sobject", "all"];
    if org != "default" {
        args.extend(["--target-org", org]);
    }
    let live_objects: Vec<String> = invoker.run_json(&args).await?;
    if live_objects.iter().any(|name| name.is_empty()) {
        return Err(invalid(
            "invalid object enumeration; previous index retained",
        ));
    }
    let live_objects: std::collections::BTreeSet<_> = live_objects
        .into_iter()
        .map(|name| name.to_ascii_lowercase())
        .collect();
    let reconcile = !live.is_empty() && !live_objects.is_empty();
    let mut sources: BTreeMap<_, _> = snapshot
        .sources
        .into_iter()
        .map(|r| Ok((key(&r)?, r)))
        .collect::<Result<_, SfError>>()?;
    let mut objects: BTreeMap<_, _> = snapshot
        .schemas
        .into_iter()
        .map(|s| (s.name.to_ascii_lowercase(), s))
        .collect();
    let old_sources: std::collections::BTreeSet<_> = sources.keys().cloned().collect();
    let old_objects: std::collections::BTreeSet<_> = objects.keys().cloned().collect();
    let changed_sources: std::collections::BTreeSet<_> =
        changed.iter().map(key).collect::<Result<_, _>>()?;
    let changed_objects: std::collections::BTreeSet<_> = schemas
        .iter()
        .map(|s| s.name.to_ascii_lowercase())
        .collect();
    for record in changed {
        sources.insert(key(&record)?, record);
    }
    for schema in schemas {
        objects.insert(schema.name.to_ascii_lowercase(), schema);
    }
    if reconcile {
        sources.retain(|identity, _| live.contains(identity));
        objects.retain(|name, _| live_objects.contains(name));
    }
    let source_keys: std::collections::BTreeSet<_> = sources.keys().cloned().collect();
    let object_keys: std::collections::BTreeSet<_> = objects.keys().cloned().collect();
    let outcome = SyncOutcome {
        added: source_keys.difference(&old_sources).count()
            + object_keys.difference(&old_objects).count(),
        removed: old_sources.difference(&source_keys).count()
            + old_objects.difference(&object_keys).count(),
        updated: changed_sources
            .intersection(&old_sources)
            .filter(|key| source_keys.contains(*key))
            .count()
            + changed_objects
                .intersection(&old_objects)
                .filter(|key| object_keys.contains(*key))
                .count(),
    };
    let sources: Vec<_> = sources.into_values().collect();
    let schemas: Vec<_> = objects.into_values().collect();
    let mut org_types = parse_org_types(&sources);
    org_types.extend(
        schemas
            .iter()
            .map(crate::apex_complete::schema_to_apex_type),
    );
    let ost = Ost {
        namespaces: snapshot.ost.namespaces,
        org_types,
    };
    let manifest = IndexManifest {
        org_id: org.to_owned(),
        api_version: api.to_owned(),
        indexed_at: started_at,
        namespaces: ost.namespaces.len(),
        classes: sources.len(),
        sobjects: schemas.len(),
        stdlib_error: snapshot.manifest.stdlib_error,
    };
    apex_lang::snapshot::save_generation(
        &root,
        &ost,
        &manifest,
        &schemas,
        true,
        Some(&sources),
        &snapshot.token,
    )
    .map_err(SfError::Spawn)?;
    Ok((outcome, ost))
}
