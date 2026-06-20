import type { SoqlResultDto, ApexOutcomeDto } from "../types";

export interface TabBase {
  id: string;
  title: string;
  /** True once the user has manually renamed the tab (stops auto-numbering). */
  renamed?: boolean;
}

export interface SoqlTab extends TabBase {
  path: string;
  query: string;
  result: SoqlResultDto | null;
  error: string | null;
  view: "table" | "tree";
}

export interface ApexTab extends TabBase {
  path: string;
  src: string;
  outcome: ApexOutcomeDto | null;
  error: string | null;
  traceOpen: boolean;
}
