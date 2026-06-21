/** Where to insert a `LIMIT` clause in a SOQL query, and the text to insert.
 *
 * SOQL clause order puts LIMIT after ORDER BY but before OFFSET / FOR …, so we
 * insert before an OFFSET/FOR clause when present, otherwise at the end.
 * ponytail: the OFFSET/FOR scan is a plain word match — fine for real queries;
 * a field literally named "for" would mis-place, but that can't occur in SOQL.
 */
export function limitInsertion(
  query: string,
  count = 200,
): { offset: number; text: string } {
  const trimmed = query.replace(/\s+$/, "");
  const m = /\b(OFFSET|FOR)\b/i.exec(trimmed);
  if (m) {
    return { offset: m.index, text: `LIMIT ${count} ` };
  }
  return { offset: trimmed.length, text: ` LIMIT ${count}` };
}
