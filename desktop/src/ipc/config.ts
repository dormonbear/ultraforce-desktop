import { invoke } from "@tauri-apps/api/core";
import type {
  CategoryLevels,
  DebugConfigDto,
  LoggingConfigDto,
  LoggingDiffDto,
  SaveOutcomeDto,
  TelemetryConfig,
} from "../types";

/** The running user's TraceFlag / DebugLevel config in `org` (null = CLI default). */
export function getDebugConfig(org: string | null): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("get_debug_config", { org });
}

/** Write the running user's debug category levels in `org`. */
export function setDebugConfig(
  levels: CategoryLevels,
  org: string | null,
): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("set_debug_config", { levels, org });
}

/** Start (or extend) a self-trace for `minutes` in `org`. */
export function quickSelfTrace(
  minutes: number,
  org: string | null,
): Promise<DebugConfigDto> {
  return invoke<DebugConfigDto>("quick_self_trace", { minutes, org });
}

/** All DebugLevels + TraceFlags in `org` (null = CLI default). */
export function loadLoggingConfig(org: string | null): Promise<LoggingConfigDto> {
  return invoke<LoggingConfigDto>("load_logging_config", { org });
}

/** Apply a logging-config diff (adds / edits / removals) to `org`. */
export function saveLoggingConfig(
  diff: LoggingDiffDto,
  org: string | null,
): Promise<SaveOutcomeDto> {
  return invoke<SaveOutcomeDto>("save_logging_config", { diff, org });
}

/** The persisted local + remote telemetry opt-in flags (both OFF by default). */
export function getTelemetryConfig(): Promise<TelemetryConfig> {
  return invoke<TelemetryConfig>("get_telemetry_config");
}

/** Whether this launch switched telemetry on by itself (dev builds seed it).
 * Sourced from the backend: Vite's DEV flag and Rust's `debug_assertions`
 * disagree under `tauri build --debug`, so the frontend can't infer it. */
export function telemetryDevSeeded(): Promise<boolean> {
  return invoke<boolean>("telemetry_dev_seeded");
}

/** Persist the local + remote telemetry opt-in flags. */
export function setTelemetryConfig(config: TelemetryConfig): Promise<void> {
  return invoke<void>("set_telemetry_config", { config });
}
