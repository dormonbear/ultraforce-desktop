//! Resolve a target once, then pin routing and cache identity for the whole run.
//! 解析目标一次，然后在整个运行中固定路由与缓存身份。

use sf_core::{OrgRegistry, SfError, SfInvoker};
use sf_schema::identity::{begin_resolution, CacheBinding};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

fn names_cache() -> &'static Mutex<HashMap<String, Arc<Vec<String>>>> {
    static NAMES: OnceLock<Mutex<HashMap<String, Arc<Vec<String>>>>> = OnceLock::new();
    NAMES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Captured bindings keep late name fetches isolated from reassigned aliases.
/// 捕获的绑定使迟到的名称查询与重绑定别名保持隔离。
pub fn install_sobject_names(binding: &CacheBinding, names: Vec<String>) {
    names_cache()
        .lock()
        .unwrap()
        .insert(binding.cache_key().to_owned(), Arc::new(names));
}

pub fn sobject_names(root: &Path, binding: &CacheBinding) -> Arc<Vec<String>> {
    if let Some(names) = names_cache()
        .lock()
        .unwrap()
        .get(binding.cache_key())
        .cloned()
    {
        return names;
    }
    Arc::new(cached_sobject_names(root, binding))
}

pub struct MetadataContext {
    pub binding: CacheBinding,
    pub api_version: String,
    pub api_version_detected: bool,
}

impl MetadataContext {
    pub fn schema_store(&self, root: impl Into<PathBuf>) -> sf_schema::SchemaStore {
        sf_schema::SchemaStore::for_target(root, self.binding.cache_key(), self.binding.username())
    }
    pub fn ost_store(&self, root: impl Into<PathBuf>) -> apex_lang::store::OstStore {
        apex_lang::store::OstStore::for_target(
            root,
            self.binding.cache_key(),
            self.binding.username(),
        )
    }
}

/// Offline-safe reuse of a verified binding for editor hot paths.
/// 编辑器高频路径可离线复用已验证绑定。
pub fn cached(root: &Path, target: &str) -> Result<Option<MetadataContext>, SfError> {
    let Some(binding) = sf_schema::identity::lookup(root, target).map_err(SfError::Spawn)? else {
        return Ok(None);
    };
    let (api_version, api_version_detected) =
        crate::api_version::bound_index_api_version(root, target, &binding, None);
    Ok(Some(MetadataContext {
        binding,
        api_version,
        api_version_detected,
    }))
}

/// Discover identity only when no verified local binding exists.
/// 仅在没有已验证本地绑定时发现身份。
pub async fn cached_or_resolve(
    invoker: &SfInvoker,
    root: &Path,
    target: &str,
) -> Result<MetadataContext, SfError> {
    match cached(root, target)? {
        Some(context) => Ok(context),
        None => resolve(invoker, root, target).await,
    }
}

/// Path to a published schema snapshot with matching context and schema version.
/// 返回上下文和结构版本均匹配的已发布 schema 快照路径。
pub fn indexed_schema_path(root: &Path, target: &str) -> Result<PathBuf, SfError> {
    let invalid = || {
        SfError::Unexpected(
            "No verified schema index; rebuild this org / 尚无已验证的 schema 索引，请重建此组织"
                .into(),
        )
    };
    let context = cached(root, target)?.ok_or_else(invalid)?;
    published_schema_path(root, &context.binding)
}

/// Validate the captured binding without resolving a mutable alias again.
/// 校验已捕获的绑定，不重新解析可变别名。
pub fn published_schema_path(root: &Path, binding: &CacheBinding) -> Result<PathBuf, SfError> {
    let invalid = || {
        SfError::Unexpected(
            "No verified schema index; rebuild this org / 尚无已验证的 schema 索引，请重建此组织"
                .into(),
        )
    };
    let key = binding.cache_key();
    let path = sf_schema::sqlite::db_path(root, key);
    let conn = sf_schema::sqlite::open_readonly(&path).map_err(|_| invalid())?;
    let meta = apex_lang::db::read_meta(&conn)
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    if meta.schema_version != apex_lang::db::SCHEMA_VERSION
        || meta.alias != key
        || meta.org_id != key
    {
        return Err(invalid());
    }
    Ok(path)
}

/// Offline FROM candidates come only from the captured user's published snapshot.
/// 离线 FROM 候选仅来自已捕获用户的已发布快照。
pub fn cached_sobject_names(root: &Path, binding: &CacheBinding) -> Vec<String> {
    let Ok(path) = published_schema_path(root, binding) else {
        return Vec::new();
    };
    let Ok(conn) = sf_schema::sqlite::open_readonly(&path) else {
        return Vec::new();
    };
    sf_schema::sqlite::list_objects(&conn)
        .unwrap_or_default()
        .into_iter()
        .map(|(name, _, _, _)| name)
        .collect()
}

/// Called after acquiring any required root lease, before metadata acquisition.
/// 在取得所需根级租约后、获取元数据前调用。
pub async fn resolve(
    invoker: &SfInvoker,
    root: &Path,
    target: &str,
) -> Result<MetadataContext, SfError> {
    let resolution = begin_resolution(root, target).map_err(SfError::Spawn)?;
    let identity = OrgRegistry::identity(invoker, (target != "default").then_some(target)).await?;
    let binding = resolution.complete(&identity).map_err(SfError::Spawn)?;
    let (api_version, api_version_detected) =
        crate::api_version::bound_index_api_version(root, target, &binding, identity.api_version);
    Ok(MetadataContext {
        binding,
        api_version,
        api_version_detected,
    })
}

#[cfg(test)]
#[path = "metadata_context_tests.rs"]
mod tests;

#[cfg(test)]
pub(crate) fn fixture_binding(root: &Path, target: &str) -> CacheBinding {
    begin_resolution(root, target)
        .unwrap()
        .complete(&sf_core::OrgIdentity {
            id: "00D000000000001".into(),
            username: target.into(),
            alias: None,
            api_version: None,
        })
        .unwrap()
}
