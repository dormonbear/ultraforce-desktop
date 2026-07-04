//! Snapshot-root resolution, shared by every subcommand.

use std::path::PathBuf;

/// Resolve the snapshot root: `--root` flag > `UF_OST_ROOT` env >
/// the desktop app's `default_index_root()`.
pub fn resolve_root(flag: Option<PathBuf>) -> PathBuf {
    flag.or_else(|| std::env::var_os("UF_OST_ROOT").map(PathBuf::from))
        .unwrap_or_else(features::apex_complete::default_index_root)
}
