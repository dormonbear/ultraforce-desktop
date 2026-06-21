/** Shape of an `index-progress` event payload (mirrors the Rust IndexProgressDto). */
export interface Progress {
  org: string;
  phase: string;
  done: number;
  total: number;
}

/** Top-bar visual state derived from the current progress (null = idle). */
export interface BarState {
  active: boolean;
  determinate: boolean;
  pct: number;
}

/**
 * Map progress to the top strip's state. Only the sObject phase carries a
 * meaningful total, so it drives a real percentage; other phases (stdlib,
 * classes) animate indeterminately. Idle → static accent bar.
 */
export function barState(p: Progress | null): BarState {
  if (!p) return { active: false, determinate: false, pct: 0 };
  const determinate = p.phase === "sobjects" && p.total > 1;
  const pct =
    p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  return { active: true, determinate, pct };
}

/** Human label for the right-side text indicator. */
export function phaseLabel(p: Progress): string {
  switch (p.phase) {
    case "sobjects":
      return `Indexing objects ${p.done}/${p.total}`;
    case "classes":
      return "Indexing Apex classes";
    default:
      return "Indexing stdlib";
  }
}
