export interface FieldValueDto {
  kind: "null" | "scalar" | "parent" | "children";
  scalar?: string;
  parent?: RecordDto;
  children?: RecordDto[];
}
export interface FieldDto {
  name: string;
  value: FieldValueDto;
}
export interface RecordDto {
  sobject_type: string;
  fields: FieldDto[];
}
export interface SoqlResultDto {
  columns: string[];
  rows: string[][];
  total_size: number;
  done: boolean;
  tree: RecordDto[];
}

export interface PlanNoteDto {
  description: string;
  fields: string[];
  table_enum_or_id: string;
}

export interface PlanRowDto {
  cardinality: number;
  leading_operation_type: string;
  relative_cost: number;
  sobject_cardinality: number;
  sobject_type: string;
  fields: string[];
  notes: PlanNoteDto[];
}

export interface QueryPlanDto {
  plans: PlanRowDto[];
  source_query: string;
}

export interface SoqlDiagnosticDto {
  message: string;
  start: number;
  end: number;
  severity: "error" | "warning";
}

export interface OrgDto {
  username: string;
  alias: string | null;
  instance_url: string | null;
  is_default: boolean;
}

export type SfCliState = "ok" | "outdated" | "not_found" | "path_issue";

export interface SfStatus {
  state: SfCliState;
  /** Raw `sf --version` output when the CLI was found. */
  version: string | null;
  /** Minimum version Ultraforce supports, e.g. "2.0.0". */
  min_version: string;
  /** Where a login-shell probe found `sf` when it isn't on the app's PATH. */
  found_at: string | null;
}

export interface ApexOutcomeDto {
  compiled: boolean;
  success: boolean;
  compile_problem: string | null;
  exception_message: string | null;
  exception_stack_trace: string | null;
  line: number | null;
  column: number | null;
  logs: string;
}

export interface LogRefDto {
  id: string;
  operation: string;
  status: string;
  start_time: string;
  application: string;
  user: string;
  duration_ms: number;
  log_length: number;
}

export interface ExecNodeDto {
  label: string;
  detail: string;
  dur_ns: number | null;
  self_ns: number | null;
  children: ExecNodeDto[];
}

export interface LimitEntryDto {
  name: string;
  used: number;
  max: number;
}

export interface LimitRollupDto {
  namespace: string;
  entries: LimitEntryDto[];
}

export interface HotspotDto {
  signature: string;
  self_ns: number;
  total_ns: number;
  self_bytes: number;
  count: number;
}

export interface StatementDto {
  kind: "soql" | "dml";
  text: string;
  rows: number;
  dur_ns: number | null;
}

export interface ExceptionDto {
  kind: string;
  message: string;
}

export interface UnitDto {
  tree: ExecNodeDto[];
  hotspots: HotspotDto[];
  statements: StatementDto[];
  limits: LimitRollupDto[];
  exceptions: ExceptionDto[];
}

export interface LogViewDto {
  raw: string;
  api_version: string | null;
  units: UnitDto[];
}

export type CategoryLevels = {
  apexCode: string;
  apexProfiling: string;
  callout: string;
  dataAccess: string;
  database: string;
  nba: string;
  system: string;
  validation: string;
  visualforce: string;
  wave: string;
  workflow: string;
};

export type DebugConfigDto = {
  traceFlagId: string | null;
  levels: CategoryLevels;
};

// ---- Debug Traces management (Configure Logging dialog) ----

export type TracedEntityKind = "User" | "ApexClass" | "ApexTrigger" | "Unknown";

export type EntityDto = { id: string; name: string; kind: TracedEntityKind };

export type TraceFlagDto = {
  id: string;
  logType: string;
  tracedEntityId: string;
  tracedEntityName: string;
  tracedEntityKind: TracedEntityKind;
  debugLevelId: string;
  debugLevelName: string;
  startDate: string | null;
  expirationDate: string | null;
  creatorName: string;
};

export type DebugLevelDto = {
  id: string;
  developerName: string;
  levels: CategoryLevels;
};

export type LoggingConfigDto = {
  traceFlags: TraceFlagDto[];
  debugLevels: DebugLevelDto[];
  entities: EntityDto[];
};

export type RecordResultDto = {
  sobject: string;
  op: string;
  id: string | null;
  ok: boolean;
  error: string | null;
};

export type SaveOutcomeDto = { results: RecordResultDto[] };

// Diff sent to save_logging_config.
export type DebugLevelDraftDto = {
  localKey: string;
  developerName: string;
  levels: CategoryLevels;
};
export type DebugLevelModDto = { id: string; levels: CategoryLevels };
export type TraceFlagDraftDto = {
  logType: string;
  tracedEntityId: string;
  debugLevelRef: string; // real DebugLevel id, or a DebugLevelDraftDto.localKey
  startDate: string | null;
  expirationDate: string | null;
};
export type TraceFlagModDto = {
  id: string;
  debugLevelId: string;
  startDate: string | null;
  expirationDate: string | null;
};
export type LoggingDiffDto = {
  debugLevelsAdded: DebugLevelDraftDto[];
  debugLevelsModified: DebugLevelModDto[];
  debugLevelsRemoved: string[];
  traceFlagsAdded: TraceFlagDraftDto[];
  traceFlagsModified: TraceFlagModDto[];
  traceFlagsRemoved: string[];
};

export interface ApexCandidateDto {
  label: string;
  kind: string;
}

/** A structured SOQL/Apex completion item (label + kind for the icon + optional detail). */
export interface CompletionItemDto {
  label: string;
  kind: string;
  detail?: string | null;
}
