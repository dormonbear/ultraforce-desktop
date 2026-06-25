import type { ExecNodeDto, UnitDto } from "../types";

/** Collect every USER_DEBUG message (in execution order) from the unit trees,
 * for a clean debug-output view separate from the noisy raw log. */
export function collectUserDebug(units: UnitDto[]): string[] {
  const out: string[] = [];
  const walk = (n: ExecNodeDto): void => {
    if (n.label === "USER_DEBUG") out.push(n.detail || "(empty)");
    for (const c of n.children) walk(c);
  };
  for (const u of units) for (const root of u.tree) walk(root);
  return out;
}
