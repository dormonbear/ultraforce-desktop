import { getJson, setJson } from "./store";

export type HistoryTool = "soql" | "apex";

export interface HistoryEntry {
  id: string;
  tool: HistoryTool;
  org: string | null;
  /** The SOQL query or Apex source that was run. */
  text: string;
  status: "success" | "error";
  durationMs: number;
  rowCount?: number;
  /** Epoch millis. */
  at: number;
}

const KEY = "history";
const CAP = 200;

type Listener = (entries: HistoryEntry[]) => void;
const listeners = new Set<Listener>();
let cache: HistoryEntry[] | null = null;

async function read(): Promise<HistoryEntry[]> {
  cache ??= await getJson<HistoryEntry[]>(KEY, []);
  return cache;
}

/** Newest-first list of recorded runs. */
export async function listHistory(): Promise<HistoryEntry[]> {
  return [...(await read())];
}

/** Record a run. Newest entries kept; oldest beyond CAP dropped (FIFO). */
export async function recordHistory(
  entry: Omit<HistoryEntry, "id" | "at">,
): Promise<void> {
  const full: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  };
  const next = [full, ...(await read())].slice(0, CAP);
  cache = next;
  await setJson(KEY, next);
  for (const fn of listeners) fn([...next]);
}

export async function clearHistory(): Promise<void> {
  cache = [];
  await setJson(KEY, []);
  for (const fn of listeners) fn([]);
}

/** Subscribe to history changes; returns an unsubscribe fn. */
export function onHistory(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
