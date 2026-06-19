import type { SoqlResultDto, ApexOutcomeDto } from "../types";

export interface TabBase {
  id: string;
  title: string;
}

export interface SoqlTab extends TabBase {
  query: string;
  result: SoqlResultDto | null;
  error: string | null;
  view: "table" | "tree";
}

export interface ApexTab extends TabBase {
  src: string;
  outcome: ApexOutcomeDto | null;
  error: string | null;
  traceOpen: boolean;
}
