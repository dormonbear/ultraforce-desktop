import { invoke } from "@tauri-apps/api/core";
import type {
  ApexCandidateDto,
  ApexOutcomeDto,
  ApexSignatureHelpDto,
  SoqlDiagnosticDto,
} from "../types";
import type { ApexSource } from "../components/useApexSource";

/** Execute anonymous Apex against `org` (null = CLI default). */
export function runApex(src: string, org: string | null): Promise<ApexOutcomeDto> {
  return invoke<ApexOutcomeDto>("run_apex", { src, org });
}

/** Diagnostics for SOQL embedded in Apex source, resolved against `org`. */
export function apexSoqlDiagnostics(
  src: string,
  org: string | null,
): Promise<SoqlDiagnosticDto[]> {
  return invoke<SoqlDiagnosticDto[]>("apex_soql_diagnostics", { src, org });
}

/** AST diagnostics (duplicate vars, unknown fields, ...) for Apex source in `org`. */
export function apexDiagnostics(
  src: string,
  org: string | null,
): Promise<SoqlDiagnosticDto[]> {
  return invoke<SoqlDiagnosticDto[]>("apex_diagnostics", { src, org });
}

/** Completion candidates at `offset` in Apex `src`, scoped to `org`. */
export function apexComplete(
  src: string,
  offset: number,
  org: string | null,
): Promise<ApexCandidateDto[]> {
  return invoke<ApexCandidateDto[]>("apex_complete", { src, offset, org });
}

/** Signature help for the call at `offset` in Apex `src` (null when none). */
export function apexSignatureHelp(
  src: string,
  offset: number,
  org: string | null,
): Promise<ApexSignatureHelpDto | null> {
  return invoke<ApexSignatureHelpDto | null>("apex_signature_help", { src, offset, org });
}

/** Pretty-print Apex source. */
export function formatApex(src: string): Promise<string> {
  return invoke<string>("format_apex", { src });
}

/** Fetch an Apex class/trigger body from `org` by name (null = CLI default). */
export function fetchApexSource(name: string, org: string | null): Promise<ApexSource> {
  return invoke<ApexSource>("fetch_apex_source", { name, org });
}
