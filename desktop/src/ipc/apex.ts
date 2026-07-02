import { invoke } from "@tauri-apps/api/core";
import type {
  ApexCandidateDto,
  ApexOutcomeDto,
  SoqlDiagnosticDto,
} from "../types";
import type { ApexSource } from "../components/useApexSource";

/** Execute anonymous Apex. */
export function runApex(src: string): Promise<ApexOutcomeDto> {
  return invoke<ApexOutcomeDto>("run_apex", { src });
}

/** Diagnostics for SOQL embedded in Apex source. */
export function apexSoqlDiagnostics(src: string): Promise<SoqlDiagnosticDto[]> {
  return invoke<SoqlDiagnosticDto[]>("apex_soql_diagnostics", { src });
}

/** AST diagnostics (duplicate vars, unknown fields, ...) for Apex source. */
export function apexDiagnostics(src: string): Promise<SoqlDiagnosticDto[]> {
  return invoke<SoqlDiagnosticDto[]>("apex_diagnostics", { src });
}

/** Completion candidates at `offset` in Apex `src`. */
export function apexComplete(
  src: string,
  offset: number,
): Promise<ApexCandidateDto[]> {
  return invoke<ApexCandidateDto[]>("apex_complete", { src, offset });
}

/** Pretty-print Apex source. */
export function formatApex(src: string): Promise<string> {
  return invoke<string>("format_apex", { src });
}

/** Fetch an Apex class/trigger body from the org by name. */
export function fetchApexSource(name: string): Promise<ApexSource> {
  return invoke<ApexSource>("fetch_apex_source", { name });
}
