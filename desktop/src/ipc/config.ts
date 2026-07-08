import { invoke } from "@tauri-apps/api/core";
import type {
  CategoryLevels,
  DebugConfigDto,
  LoggingConfigDto,
  LoggingDiffDto,
  SaveOutcomeDto,
  TelemetryConfig,
} from "../types";

/** The running user's TraceFlag / DebugLevel config. */
export function getDebugConfig(): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("get_debug_config");
}

/** Write the running user's debug category levels. */
export function setDebugConfig(levels: CategoryLevels): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("set_debug_config", { levels });
}

/** Start (or extend) a self-trace for `minutes`. */
export function quickSelfTrace(minutes: number): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("quick_self_trace", { minutes });
}

/** All DebugLevels + TraceFlags in the target org. */
export function loadLoggingConfig(): Promise<LoggingConfigDto> {
  return invoke<LoggingConfigDto>("load_logging_config");
}

/** Apply a logging-config diff (adds / edits / removals). */
export function saveLoggingConfig(diff: LoggingDiffDto): Promise<SaveOutcomeDto> {
  return invoke<SaveOutcomeDto>("save_logging_config", { diff });
}

/** The persisted local + remote telemetry opt-in flags (both OFF by default). */
export function getTelemetryConfig(): Promise<TelemetryConfig> {
  return invoke<TelemetryConfig>("get_telemetry_config");
}

/** Persist the local + remote telemetry opt-in flags. */
export function setTelemetryConfig(config: TelemetryConfig): Promise<void> {
  return invoke<void>("set_telemetry_config", { config });
}
