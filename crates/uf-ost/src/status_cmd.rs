//! `uf-ost status` — dump each org's freshness, counts, and `stdlib_error`
//! from the shell (the CLI mirror of the `ost_status` MCP tool).

use std::path::Path;

use crate::{lock, query};

/// Print a one-line status per org (or just `org` when given). Never opens a DB
/// for writing; a missing/empty index prints a clear "not indexed" line.
pub fn run(root: &Path, org: Option<String>) {
    let orgs = match org {
        Some(o) => vec![o],
        None => query::list_orgs(root),
    };
    if orgs.is_empty() {
        println!("no indexed orgs under {}", root.display());
        return;
    }
    for org in orgs {
        match query::open_org(root, &org) {
            Ok(snap) => {
                let s = query::status(&snap, lock::is_running(root, &org));
                let err = s
                    .stdlib_error
                    .as_deref()
                    .map(|e| format!("  stdlib_error: {e}"))
                    .unwrap_or_default();
                let reindex = if s.reindex_in_progress {
                    "  [reindexing]"
                } else {
                    ""
                };
                println!(
                    "{}  gen {}  api {}  {} classes / {} sObjects / {} ns  ({}){}{}",
                    s.org,
                    s.generation,
                    s.api_version,
                    s.classes,
                    s.sobjects,
                    s.namespaces,
                    s.age,
                    reindex,
                    err
                );
            }
            Err(e) => println!("{org}: {e}"),
        }
    }
}
