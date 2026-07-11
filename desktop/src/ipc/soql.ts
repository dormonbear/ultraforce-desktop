import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnLabelsDto,
  CompletionItemDto,
  QueryPlanDto,
  SoqlDiagnosticDto,
  SoqlResultDto,
} from "../types";

/** Run a SOQL query (paginated; emits `soql-progress` events keyed by `queryId`). */
export function runSoql(args: {
  query: string;
  useToolingApi: boolean;
  allRows: boolean;
  queryId: string;
}): Promise<SoqlResultDto> {
  return invoke<SoqlResultDto>("run_soql", args);
}

/** Pre-flight COUNT() for a query; null when the count isn't available. */
export function countSoql(args: {
  query: string;
  useToolingApi: boolean;
  queryId: string;
}): Promise<number | null> {
  return invoke<number | null>("count_soql", args);
}

/** Cancel a running query / count by its `queryId`. */
export function cancelSoql(queryId: string): Promise<void> {
  return invoke("cancel_soql", { queryId });
}

/** Fetch the query plan (explain) for a query. */
export function queryPlan(query: string): Promise<QueryPlanDto> {
  return invoke<QueryPlanDto>("query_plan", { query });
}

/** Diagnostics (unknown fields/objects, missing LIMIT, ...) for a query. */
export function soqlDiagnostics(query: string): Promise<SoqlDiagnosticDto[]> {
  return invoke<SoqlDiagnosticDto[]>("soql_diagnostics", { query });
}

/** Completion candidates at `offset` in `query`. */
export function soqlComplete(
  query: string,
  offset: number,
): Promise<CompletionItemDto[]> {
  return invoke<CompletionItemDto[]>("soql_complete", { query, offset });
}

/** Pretty-print a SOQL query. */
export function formatSoql(query: string): Promise<string> {
  return invoke<string>("format_soql", { query });
}

/**
 * Schema labels for a query's result columns (API name ↔ label toggle).
 * Best-effort: unresolvable columns are absent from the maps.
 */
export function soqlColumnLabels(args: {
  query: string;
  columns: string[];
  childColumns: Record<string, string[]>;
}): Promise<ColumnLabelsDto> {
  return invoke<ColumnLabelsDto>("soql_column_labels", args);
}
