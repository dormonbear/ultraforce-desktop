/** Canvas fill (hex) for a flame rect by event-kind name. Mirrors the category
 * coloring of LogView's eventColor as concrete hex for canvas drawing. */
export function flameColor(kind: string): string {
  if (/FATAL_ERROR|EXCEPTION_THROWN/.test(kind)) return "#ef4444"; // red
  if (kind === "USER_DEBUG") return "#3b82f6"; // blue
  if (/SOQL_EXECUTE|SOSL_EXECUTE|DML_|CALLOUT_/.test(kind)) return "#22c55e"; // green
  if (/CONSTRUCTOR_/.test(kind)) return "#a855f7"; // purple
  if (/METHOD_|CODE_UNIT_|EXECUTION_/.test(kind)) return "#64748b"; // slate
  return "#475569"; // dim
}
