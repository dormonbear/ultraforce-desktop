import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { SheetData } from "write-excel-file/browser";
import { guardFormula, toCsv } from "./csv";

export type ExportFormat = "csv" | "tsv" | "json" | "xlsx" | "md";

export interface ExportFormatDef {
  id: ExportFormat;
  label: string;
  ext: string;
}

export const EXPORT_FORMATS: ExportFormatDef[] = [
  { id: "csv", label: "CSV", ext: "csv" },
  { id: "tsv", label: "TSV", ext: "tsv" },
  { id: "json", label: "JSON", ext: "json" },
  { id: "xlsx", label: "Excel (XLSX)", ext: "xlsx" },
  { id: "md", label: "Markdown", ext: "md" },
];

/** Tab-separated. Embedded tabs/newlines are collapsed to spaces (TSV has no quoting). */
export function toTsv(columns: string[], rows: string[][]): string {
  const clean = (s: string) => guardFormula((s ?? "").replace(/[\t\r\n]+/g, " "));
  const lines = [columns.map(clean).join("\t")];
  for (const row of rows) {
    lines.push(columns.map((_, i) => clean(row[i] ?? "")).join("\t"));
  }
  return lines.join("\n") + "\n";
}

/** Array of row objects keyed by column name. */
export function toJson(columns: string[], rows: string[][]): string {
  const objs = rows.map((r) =>
    Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""])),
  );
  return JSON.stringify(objs, null, 2);
}

/** GitHub-flavored Markdown table; `|` escaped, newlines become <br>. */
export function toMarkdown(columns: string[], rows: string[][]): string {
  const esc = (s: string) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const head = `| ${columns.map(esc).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${columns.map((_, i) => esc(r[i] ?? "")).join(" | ")} |`);
  return [head, sep, ...body].join("\n") + "\n";
}

/** Serialize to a text format (everything except xlsx). */
function toText(
  format: Exclude<ExportFormat, "xlsx">,
  columns: string[],
  rows: string[][],
): string {
  switch (format) {
    case "csv":
      return toCsv(columns, rows);
    case "tsv":
      return toTsv(columns, rows);
    case "json":
      return toJson(columns, rows);
    case "md":
      return toMarkdown(columns, rows);
  }
}

/** Write a query result to `path` in the chosen format (binary for xlsx, text otherwise). */
export async function writeExportFile(
  path: string,
  fmt: ExportFormatDef,
  columns: string[],
  rows: string[][],
): Promise<void> {
  if (fmt.id === "xlsx") {
    await writeFile(path, await toXlsxBytes(columns, rows));
  } else {
    await writeTextFile(path, toText(fmt.id, columns, rows));
  }
}

/** Build .xlsx file bytes. Values stay strings so Excel never mangles Ids/dates. */
async function toXlsxBytes(
  columns: string[],
  rows: string[][],
): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const data: SheetData = [
    columns.map((c) => ({ value: c, fontWeight: "bold" as const })),
    ...rows.map((r) => columns.map((_, i) => ({ value: r[i] ?? "", type: String }))),
  ];
  const blob = await writeXlsxFile(data).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
