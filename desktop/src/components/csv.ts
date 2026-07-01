/** Serialize a table (columns + string rows) to RFC 4180 CSV text. */
export function toCsv(columns: string[], rows: string[][]): string {
  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((_, i) => escape(row[i] ?? "")).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Quote a field when it contains a comma, quote, CR, or LF; double inner quotes. */
function escape(field: string): string {
  const f = guardFormula(field);
  if (/[",\r\n]/.test(f)) {
    return `"${f.replace(/"/g, '""')}"`;
  }
  return f;
}

/**
 * Prefix a leading apostrophe to values a spreadsheet would auto-evaluate as a
 * formula (CSV/TSV injection). Guards `= + @` and CR/Tab always, and `-` only
 * when it doesn't start a plain number (so `-5`, `-5.2` stay numeric).
 */
export function guardFormula(field: string): string {
  return /^[=+@\t\r]/.test(field) || /^-(?![\d.])/.test(field)
    ? `'${field}`
    : field;
}
