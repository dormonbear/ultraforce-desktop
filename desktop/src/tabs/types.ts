import type { SoqlResultDto, ApexOutcomeDto, QueryPlanDto } from "../types";

export interface TabBase {
  id: string;
  title: string;
  /** File path, if any — shown as a hover tooltip to disambiguate same-named tabs. */
  path?: string;
  /** True once the user has manually renamed the tab (stops auto-numbering). */
  renamed?: boolean;
}

export interface SoqlTab extends TabBase {
  path: string;
  query: string;
  /** Round-trip time of the last run, in ms (shown in the status line). */
  lastMs?: number;
  result: SoqlResultDto | null;
  error: string | null;
  useToolingApi: boolean;
  allRows: boolean;
  plan: QueryPlanDto | null;
}

export interface ApexTab extends TabBase {
  path: string;
  src: string;
  outcome: ApexOutcomeDto | null;
  error: string | null;
  traceOpen: boolean;
}
