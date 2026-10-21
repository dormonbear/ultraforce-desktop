//! `uf-ost index` — headless indexer (absorbs the old `features` `ost-index`
//! bin). Full `index_org` or watermark `sync_org` into SQLite. Used by
//! launchd/cron and spawned detached by `ost_reindex`.

use std::path::PathBuf;
use std::sync::Arc;

use features::index::{index_org_for_target, sync_org_for_target, IndexProgress, NamespacePolicy};
use sf_core::{ProcessRunner, SfInvoker};

use crate::lock::ReindexLock;

/// Run a full index (or `--sync` delta) for `org` into `root`. Progress and the
/// outcome print to stderr so stdout stays clean for any caller capturing it.
pub async fn run(org: String, root: PathBuf, policy: String, sync: bool) -> Result<(), String> {
    // Own the root-wide lease before slow CLI work; sync uses generation CAS. / 慢速 CLI 工作前持有根级租约；增量同步使用代次 CAS。
    let _lock = if sync {
        None
    } else if let Ok(token) = std::env::var(crate::lock::RESERVATION_ENV) {
        Some(ReindexLock::adopt(&root, &org, &token).map_err(|e| e.to_string())?)
    } else {
        match ReindexLock::acquire(&root, &org).map_err(|e| e.to_string())? {
            Some(lock) => Some(lock),
            None => {
                eprintln!("index {org}: another reindex is already running; skipping / 另一个重建正在运行；跳过");
                return Ok(());
            }
        }
    };
    // The slow calls (completions, full ApexClass SymbolTable query) carry their
    // own extended per-call timeouts in acquire.rs — no bin-level override.
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let policy = NamespacePolicy::parse(&policy);
    let context = features::metadata_context::resolve(&invoker, &root, &org)
        .await
        .map_err(|error| error.to_string())?;
    let api = context.api_version;
    let binding = context.binding;

    if sync {
        crate::query::open_bound_org(&root, &org, &binding).map_err(|error| error.to_string())?;
        let (o, _) = sync_org_for_target(
            &invoker,
            root,
            binding.cache_key(),
            binding.username(),
            &api,
            &policy,
        )
        .await
        .map_err(|e| e.to_string())?;
        eprintln!("sync {org}: +{} ~{} -{}", o.added, o.updated, o.removed);
    } else {
        let mut last = String::new();
        index_org_for_target(
            &invoker,
            root.clone(),
            binding.cache_key(),
            binding.username(),
            &api,
            &policy,
            &mut |p: IndexProgress| {
                if p.phase != last {
                    eprintln!("[{org}] {} {}/{}", p.phase, p.done, p.total);
                    last = p.phase.to_string();
                }
            },
        )
        .await
        .map_err(|e| e.to_string())?;
        eprintln!("index {org}: wrote under {}", root.display());
    }
    Ok(())
}
