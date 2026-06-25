/** Governor-limit math for the LIMITS dashboard. Pure, so it's unit-testable. */

export interface LimitEntryLike {
  name: string;
  used: number;
  max: number;
}

/** ok < 60% used, warn 60–90%, crit ≥ 90% (or at/over the cap). */
export type LimitSeverity = "ok" | "warn" | "crit";

/** Usage as a 0–100 integer percent (0 when there is no cap). */
export function usagePct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export function limitSeverity(used: number, max: number): LimitSeverity {
  if (max <= 0) return "ok";
  const ratio = used / max;
  if (ratio >= 0.9) return "crit";
  if (ratio >= 0.6) return "warn";
  return "ok";
}

/** Entries sorted tightest-first (highest usage ratio), so the limit most at
 * risk of breaching surfaces at the top of the dashboard. */
export function rankByUsage<T extends LimitEntryLike>(entries: T[]): T[] {
  const ratio = (e: LimitEntryLike) => (e.max > 0 ? e.used / e.max : 0);
  return [...entries].sort((a, b) => ratio(b) - ratio(a));
}
