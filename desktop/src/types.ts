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

export interface SfStatus {
  installed: boolean;
  version: string | null;
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

export interface UnitDto {
  tree: ExecNodeDto[];
  hotspots: HotspotDto[];
  statements: StatementDto[];
  limits: LimitRollupDto[];
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
