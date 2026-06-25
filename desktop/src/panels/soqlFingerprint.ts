/**
 * Normalize a SOQL/DML statement to a fingerprint so statements that differ only
 * by their literal values group together. A loop almost always binds a different
 * id each iteration (`WHERE Id = '001...'`), so grouping by exact text misses
 * the very SOQL-in-loop we want to flag; grouping by fingerprint catches the
 * whole family. (Same idea as pt-query-digest / pg_stat_statements.)
 */
export function soqlFingerprint(text: string): string {
  return (
    text
      // string literals → ?
      .replace(/'(?:[^'\\]|\\.)*'/g, "?")
      // IN (…) / INCLUDES (…) value lists → single placeholder
      .replace(/\b(IN|INCLUDES|EXCLUDES)\s*\([^)]*\)/gi, "$1 (?)")
      // bind variables (:var) → :?
      .replace(/:\w+/g, ":?")
      // standalone numbers (LIMIT 200, Amount > 100, LAST_N_DAYS:90) → ?
      .replace(/\b\d+(?:\.\d+)?\b/g, "?")
      // collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}
