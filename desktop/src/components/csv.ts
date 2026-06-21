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
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
