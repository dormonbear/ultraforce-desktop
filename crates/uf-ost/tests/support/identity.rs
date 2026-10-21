use sf_schema::identity::{begin_resolution, lookup, CacheBinding};
use std::path::{Path, PathBuf};

pub(super) fn fixture_binding(root: &Path, target: &str) -> CacheBinding {
    lookup(root, target).unwrap().unwrap_or_else(|| {
        begin_resolution(root, target)
            .unwrap()
            .complete(&sf_core::OrgIdentity {
                id: "00D000000000001".into(),
                username: target.into(),
                alias: None,
                api_version: None,
            })
            .unwrap()
    })
}

pub(super) fn fixture_db_path(root: &Path, target: &str) -> PathBuf {
    sf_schema::sqlite::db_path(root, fixture_binding(root, target).cache_key())
}

pub(super) async fn index_fixture(
    invoker: &sf_core::SfInvoker,
    root: PathBuf,
    target: &str,
    api: &str,
    policy: &features::index::NamespacePolicy,
    progress: &mut (dyn FnMut(features::index::IndexProgress) + Send),
) -> Result<apex_lang::Ost, sf_core::SfError> {
    let binding = fixture_binding(&root, target);
    features::index::index_org_for_target(
        invoker,
        root,
        binding.cache_key(),
        target,
        api,
        policy,
        progress,
    )
    .await
}

pub(super) async fn sync_fixture(
    invoker: &sf_core::SfInvoker,
    root: PathBuf,
    target: &str,
    api: &str,
    policy: &features::index::NamespacePolicy,
) -> Result<(features::index::SyncOutcome, apex_lang::Ost), sf_core::SfError> {
    let binding = fixture_binding(&root, target);
    features::index::sync_org_for_target(invoker, root, binding.cache_key(), target, api, policy)
        .await
}

pub(super) fn load_fixture_snapshot(
    root: &Path,
    target: &str,
    api: &str,
) -> Option<(apex_lang::Ost, apex_lang::IndexManifest)> {
    apex_lang::load_snapshot(root, fixture_binding(root, target).cache_key(), api)
}

pub(super) fn fixture_generation_token(
    root: &Path,
    target: &str,
) -> std::io::Result<apex_lang::snapshot::GenerationToken> {
    apex_lang::snapshot::generation_token(root, fixture_binding(root, target).cache_key())
}
