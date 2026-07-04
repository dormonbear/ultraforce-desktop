//! `uf-ost index` — headless indexer (absorbs the old `features` `ost-index`
//! bin). Full `index_org` or watermark `sync_org` into SQLite. Used by
//! launchd/cron and spawned detached by `ost_reindex`.

use std::path::PathBuf;
use std::sync::Arc;

use features::index::{index_org, sync_org, IndexProgress, NamespacePolicy};
use sf_core::{ProcessRunner, SfInvoker};

use crate::lock::ReindexLock;

/// Run a full index (or `--sync` delta) for `org` into `root`. Progress and the
/// outcome print to stderr so stdout stays clean for any caller capturing it.
pub async fn run(org: String, root: PathBuf, policy: String, sync: bool) -> Result<(), String> {
    // The slow calls (completions, full ApexClass SymbolTable query) carry their
    // own extended per-call timeouts in acquire.rs — no bin-level override.
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));
    let policy = NamespacePolicy::parse(&policy);

    if sync {
        let (o, _) = sync_org(&invoker, root, &org, &policy)
            .await
            .map_err(|e| e.to_string())?;
        eprintln!("sync {org}: +{} ~{} -{}", o.added, o.updated, o.removed);
    } else {
        // Full reindex is the global singleton: hold the lock for its duration
        // (spec §5), so a second indexer or `ost_status` sees it in progress.
        let _lock = match ReindexLock::acquire(&root, &org).map_err(|e| e.to_string())? {
            Some(lock) => lock,
            None => {
                eprintln!("index {org}: another reindex is already running; skipping");
                return Ok(());
            }
        };
        let mut last = String::new();
        index_org(
            &invoker,
            root.clone(),
            &org,
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
