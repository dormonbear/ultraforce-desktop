//! Opt-in telemetry config orchestration. Persists to the SHARED cache root
//! (`features::apex_complete::default_index_root()` → `<root>/telemetry.json`)
//! so the standalone uf-ost MCP binary reads the same file.

use crate::dto::TelemetryConfigDto;
use crate::error::CommandError;
use features::telemetry_config::{self, TelemetryConfig};

pub(crate) fn get_telemetry_config() -> Result<TelemetryConfigDto, CommandError> {
    let root = features::apex_complete::default_index_root();
    let cfg = telemetry_config::load(&root);
    Ok(TelemetryConfigDto::from(&cfg))
}

pub(crate) fn set_telemetry_config(config: TelemetryConfigDto) -> Result<(), CommandError> {
    let root = features::apex_complete::default_index_root();
    let cfg = TelemetryConfig::from(&config);
    telemetry_config::save(&root, &cfg).map_err(|e| {
        CommandError::new("io", format!("Failed to save telemetry config: {e}"))
    })
}
