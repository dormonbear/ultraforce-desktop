use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::symbols::Ost;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct IndexManifest {
    pub org_id: String,
    pub api_version: String,
    pub indexed_at: String,
    pub namespaces: usize,
    pub classes: usize,
    pub sobjects: usize,
}

fn org_dir(root: &Path, org_id: &str) -> std::path::PathBuf {
    // Sanitize to match OstStore/SchemaStore's org dir, so the schema-cache
    // clear in `reindex_org` also removes the snapshot.
    root.join(crate::store::sanitize(org_id))
}

/// Persist the assembled OST + manifest under `<root>/<org_id>/`.
pub fn save_snapshot(root: &Path, ost: &Ost, manifest: &IndexManifest) -> std::io::Result<()> {
    let dir = org_dir(root, &manifest.org_id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        dir.join("index.json"),
        serde_json::to_vec_pretty(ost).unwrap(),
    )?;
    std::fs::write(
        dir.join("index.meta.json"),
        serde_json::to_vec_pretty(manifest).unwrap(),
    )?;
    Ok(())
}

/// Load a persisted snapshot, or `None` when absent / built for another API version.
pub fn load_snapshot(root: &Path, org_id: &str, api_version: &str) -> Option<(Ost, IndexManifest)> {
    let dir = org_dir(root, org_id);
    let manifest: IndexManifest =
        serde_json::from_slice(&std::fs::read(dir.join("index.meta.json")).ok()?).ok()?;
    if manifest.api_version != api_version {
        return None;
    }
    let ost: Ost = serde_json::from_slice(&std::fs::read(dir.join("index.json")).ok()?).ok()?;
    Some((ost, manifest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbols::{ApexType, Ost};

    fn sample() -> (Ost, IndexManifest) {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Foo".into(),
                ..Default::default()
            }],
        };
        let m = IndexManifest {
            org_id: "myorg".into(),
            api_version: "60.0".into(),
            indexed_at: "2026-06-21T00:00:00Z".into(),
            namespaces: 0,
            classes: 1,
            sobjects: 0,
        };
        (ost, m)
    }

    #[test]
    fn save_then_load_roundtrips() {
        let root = std::env::temp_dir().join(format!("snap-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        let (got_ost, got_m) = load_snapshot(&root, "myorg", "60.0").unwrap();
        assert_eq!(got_ost, ost);
        assert_eq!(got_m, m);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_returns_none_on_api_mismatch() {
        let root = std::env::temp_dir().join(format!("snap2-{}", std::process::id()));
        let (ost, m) = sample();
        save_snapshot(&root, &ost, &m).unwrap();
        assert!(load_snapshot(&root, "myorg", "61.0").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
