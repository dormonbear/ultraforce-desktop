//! `uf-ost index` — headless indexer (absorbs the old `features` `ost-index`
//! bin). Full `index_org` or watermark `sync_org` into SQLite. Used by
//! launchd/cron and spawned detached by `ost_reindex`.

use std::path::PathBuf;
use std::sync::Arc;

use features::api_version::resolve_index_api_version;
use features::index::{index_org, sync_org, IndexProgress, NamespacePolicy};
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
    // Fallback-aware: a failed detection reuses the snapshot's stored version.
    let (api, _) = resolve_index_api_version(&invoker, &root, &org).await;

    if sync {
        let (o, _) = sync_org(&invoker, root, &org, &api, &policy)
            .await
            .map_err(|e| e.to_string())?;
        eprintln!("sync {org}: +{} ~{} -{}", o.added, o.updated, o.removed);
    } else {
        let mut last = String::new();
        index_org(
            &invoker,
            root.clone(),
            &org,
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
