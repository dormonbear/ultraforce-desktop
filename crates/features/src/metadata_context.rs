//! Resolve a target once, then pin routing and cache identity for the whole run.
//! 解析目标一次，然后在整个运行中固定路由与缓存身份。

use sf_core::{OrgRegistry, SfError, SfInvoker};
use sf_schema::identity::{begin_resolution, CacheBinding};
use std::path::Path;

pub struct MetadataContext {
    pub binding: CacheBinding,
    pub api_version: String,
    pub api_version_detected: bool,
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
