import type { LogRefDto } from "../types";

export interface LogFilter {
  query: string; // matches operation or user, case-insensitive
}

export const EMPTY_FILTER: LogFilter = { query: "" };

export function filterLogs(logs: LogRefDto[], f: LogFilter): LogRefDto[] {
  const q = f.query.trim().toLowerCase();
  if (!q) return logs;
  return logs.filter((l) =>
    `${l.operation} ${l.user}`.toLowerCase().includes(q),
  );
}

/** "46070" ms → "46.1s"; sub-second stays in ms. */
export function fmtDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Bytes → KB/MB, one decimal. */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** ISO start time → short local "MM/DD HH:MM". Empty/invalid → "". */
export function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
