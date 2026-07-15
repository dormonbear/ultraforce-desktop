import type { SourceRef } from "./panels/sourceRef";

/** A raw JSON scalar from a SOQL child table (typed — numbers stay numbers). */
export type Scalar = string | number | boolean | null;

/** One subquery result attached to one parent row (sparse sidecar entry). */
export interface ChildTableDto {
  rowIndex: number;
  column: string;
  totalSize: number;
  done: boolean;
  columns: string[];
  rows: Scalar[][];
  /** Nested subqueries inside child records; rowIndex points into `rows`. */
  children: ChildTableDto[];
}

export interface SoqlResultDto {
  columns: string[];
  rows: string[][];
  totalSize: number;
  done: boolean;
  childTables: ChildTableDto[];
}

/** Display labels for one child relationship's table (label toggle). */
export interface ChildLabelsDto {
  label: string | null;
  columns: Record<string, string>;
}

/**
 * Display labels for a query's result columns (API name ↔ label toggle).
 * Unresolvable columns are absent — fall back to API names.
 */
export interface ColumnLabelsDto {
  parent: Record<string, string>;
  children: Record<string, ChildLabelsDto>;
}

export interface PlanNoteDto {
  description: string;
  fields: string[];
  tableEnumOrId: string;
}

export interface PlanRowDto {
  cardinality: number;
  leadingOperationType: string;
  relativeCost: number;
  sobjectCardinality: number;
  sobjectType: string;
  fields: string[];
  notes: PlanNoteDto[];
}

export interface QueryPlanDto {
  plans: PlanRowDto[];
  sourceQuery: string;
}

export interface SoqlDiagnosticDto {
  message: string;
  start: number;
  end: number;
  severity: "error" | "warning";
}

/** One inner subquery `(SELECT … )` range as UTF-16 offsets into the query text
 * (feed straight into Monaco `model.getPositionAt`). */
export interface SubquerySpanDto {
  start: number;
  end: number;
}

export interface OrgDto {
  username: string;
  alias: string | null;
  instanceUrl: string | null;
  isDefault: boolean;
  isSandbox: boolean;
  isScratch: boolean;
}

/**
 * Per-org, display + behavior config persisted in the tauri-plugin-store file
 * under `orgConfig.<username>`. Rust reads `apiVersion`/`timeoutSecs` from the
 * same store; `alias`/`color` are display-only (titlebar badge + switcher row).
 * All fields optional — an unset field means "use the org's dynamic default".
 */
export interface OrgConfig {
  /** Normalized Salesforce API version, e.g. "58.0". Overrides the detected one. */
  apiVersion?: string;
  /** Request timeout in whole seconds applied to this org's `sf` calls. */
  timeoutSecs?: number;
  /** Display alias shown on the badge / switcher row (does not rename the org). */
  alias?: string;
  /** Preset palette color id (see ORG_COLORS) for the badge / row swatch. */
  color?: string;
}

/** Queryable index-lifecycle snapshot for one org (mirrors Rust `IndexStatusDto`). */
export interface IndexStatus {
  org: string;
  state: "idle" | "indexing" | "ready" | "error";
  phase: string | null;
  done: number | null;
  total: number | null;
  /** Epoch millis of the last successful index. */
  lastIndexed: number | null;
  error: string | null;
}

export type SfCliState = "ok" | "outdated" | "not_found" | "path_issue";

export interface SfStatus {
  state: SfCliState;
  /** Raw `sf --version` output when the CLI was found. */
  version: string | null;
  /** Minimum version Ultraforce supports, e.g. "2.0.0". */
  minVersion: string;
  /** Where a login-shell probe found `sf` when it isn't on the app's PATH. */
  foundAt: string | null;
}

export interface ApexOutcomeDto {
  compiled: boolean;
  success: boolean;
  compileProblem: string | null;
  exceptionMessage: string | null;
  exceptionStackTrace: string | null;
  line: number | null;
  column: number | null;
  logs: string;
}

export interface LogRefDto {
  id: string;
  operation: string;
  status: string;
  startTime: string;
  application: string;
  user: string;
  durationMs: number;
  logLength: number;
}

export interface ExecNodeDto {
  label: string;
  detail: string;
  durNs: number | null;
  selfNs: number | null;
  /** Absolute start offset in ns from log start. */
  startNs: number;
  children: ExecNodeDto[];
  /** Apex source this node maps to (class + line), or null when unresolved. */
  source: SourceRef | null;
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
  selfNs: number;
  totalNs: number;
  selfBytes: number;
  count: number;
}

export interface StatementDto {
  kind: "soql" | "dml";
  text: string;
  rows: number;
  durNs: number | null;
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
  apiVersion: string | null;
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
  expirationDate: string | null;
};

export type TelemetryConfig = {
  localEnabled: boolean;
  remoteEnabled: boolean;
};

// ---- Debug Traces management (Configure Logging dialog) ----

export type TracedEntityKind = "User" | "ApexClass" | "ApexTrigger" | "Unknown";

export type EntityDto = {
  id: string;
  name: string;
  kind: TracedEntityKind;
  /** Searchable terms not shown in `name` (e.g. a user's Email). */
  keywords: string[];
};

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
  detail?: string | null;
  params?: string[] | null;
}

export interface ApexSignatureDto {
  label: string;
  params: string[];
}
export interface ApexSignatureHelpDto {
  signatures: ApexSignatureDto[];
  activeSignature: number;
  activeParameter: number;
}

/** A structured SOQL/Apex completion item (label + kind for the icon + optional detail). */
export interface CompletionItemDto {
  label: string;
  kind: string;
  detail?: string | null;
}

// ---- Schema browser DTOs (mirror of src-tauri/src/dto.rs) ------------------

/** One object in the schema-browser list. */
export interface SchemaObject {
  name: string;
  label: string;
  custom: boolean;
  keyPrefix: string | null;
}

/** One picklist entry on a schema field. */
export interface SchemaPicklistValue {
  label: string;
  value: string;
  active: boolean;
  defaultValue: boolean;
}

/** A single field in an object's schema detail. */
export interface SchemaField {
  name: string;
  label: string;
  fieldType: string;
  custom: boolean;
  nillable: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: SchemaPicklistValue[];
  restrictedPicklist: boolean;
  dependentPicklist: boolean;
  calculated: boolean;
  calculatedFormula: string | null;
  length: number;
  unique: boolean;
  inlineHelpText: string | null;
}

/** A record type's identity in an object's schema detail. */
export interface SchemaRecordType {
  name: string;
  developerName: string;
  active: boolean;
  master: boolean;
  available: boolean;
}

/** A child relationship pointing back to the object. */
export interface SchemaChildRelationship {
  childSObject: string;
  relationshipName: string | null;
  field: string;
}

/** Full schema detail for one object. */
export interface SchemaObjectDetail {
  name: string;
  label: string;
  keyPrefix: string | null;
  custom: boolean;
  fields: SchemaField[];
  childRelationships: SchemaChildRelationship[];
  recordTypes: SchemaRecordType[];
}

/** One hit from the schema search palette. */
export interface SchemaSearchHit {
  objectName: string;
  fieldName: string;
  fieldLabel: string;
  snippet: string;
}

/** One metadata component that references a field ("where-used" row). */
export interface FieldDependency {
  componentType: string;
  componentName: string;
  componentId: string;
}

/** A field's where-used result plus when the cache was populated.
 * `supported: false` (with `fetchedAt: null`) marks a standard field the
 * Dependency API can't track. */
export interface FieldDependencies {
  supported: boolean;
  items: FieldDependency[];
  fetchedAt: number | null;
}
