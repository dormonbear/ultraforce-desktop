//! Shared telemetry config. Both sinks default OFF; a missing or unparseable
//! `telemetry.json` yields `TelemetryConfig::default()` (both false), never a panic.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TelemetryConfig {
    pub local_enabled: bool,
    pub remote_enabled: bool,
}

/// `<root>/telemetry.json`.
pub fn config_path(root: &Path) -> PathBuf {
    root.join("telemetry.json")
}

/// Reads the config. A missing or unparseable file yields `Default` (both false).
/// Never errors.
pub fn load(root: &Path) -> TelemetryConfig {
    std::fs::read_to_string(config_path(root))
        .ok()
        .and_then(|s| serde_json::from_str::<TelemetryConfig>(&s).ok())
        .unwrap_or_default()
}

/// Writes the config as pretty JSON, creating `root` if needed.
pub fn save(root: &Path, cfg: &TelemetryConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    let json = serde_json::to_string_pretty(cfg)?;
    std::fs::write(config_path(root), json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_off_when_absent() {
        let dir = std::env::temp_dir().join(format!("uf-tc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = load(&dir);
        assert!(!c.local_enabled && !c.remote_enabled);
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test]
    fn roundtrip_and_partial_json_defaults() {
        let dir = std::env::temp_dir().join(format!("uf-tc2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        save(&dir, &TelemetryConfig { local_enabled: true, remote_enabled: false }).unwrap();
        let c = load(&dir);
        assert!(c.local_enabled && !c.remote_enabled);
        // partial/garbage JSON ⇒ defaults, never panics
        std::fs::write(config_path(&dir), "{\"localEnabled\":true}").unwrap();
        assert!(load(&dir).local_enabled && !load(&dir).remote_enabled);
        std::fs::write(config_path(&dir), "not json").unwrap();
        let c = load(&dir);
        assert!(!c.local_enabled && !c.remote_enabled);
        std::fs::remove_dir_all(&dir).ok();
    }
}
