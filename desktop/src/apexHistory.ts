import { getJson, setJson } from "./store";

export interface ApexHistoryEntry {
  id: string;
  org: string | null;
  /** The anonymous Apex source that was executed. */
  source: string;
  /** Raw debug log returned by the run (may be truncated, see MAX_LOG). */
  logs: string;
  compiled: boolean;
  success: boolean;
  exceptionMessage: string | null;
  /** Epoch millis. */
  at: number;
}

const KEY = "apex-history";
const CAP = 50;
// Bound per-entry log size so 50 stored runs can't balloon the store file.
const MAX_LOG = 200_000;

type Listener = (entries: ApexHistoryEntry[]) => void;
const listeners = new Set<Listener>();
let cache: ApexHistoryEntry[] | null = null;

/** Entries persisted before the camelCase rename carry `exception_message`. */
function migrate(e: ApexHistoryEntry): ApexHistoryEntry {
  const legacy = e as ApexHistoryEntry & { exception_message?: string | null };
  return {
    ...e,
    exceptionMessage: e.exceptionMessage ?? legacy.exception_message ?? null,
  };
}

async function read(): Promise<ApexHistoryEntry[]> {
  cache ??= (await getJson<ApexHistoryEntry[]>(KEY, [])).map(migrate);
  return cache;
}

/** Newest-first list of recorded Apex executions. */
export async function listApexHistory(): Promise<ApexHistoryEntry[]> {
  return [...(await read())];
}

/** Record one execution. Newest kept; oldest beyond CAP dropped (FIFO). */
export async function recordApexRun(
  entry: Omit<ApexHistoryEntry, "id" | "at">,
): Promise<void> {
  const logs =
    entry.logs.length > MAX_LOG
      ? entry.logs.slice(0, MAX_LOG) + "\n… (log truncated)"
      : entry.logs;
  const full: ApexHistoryEntry = {
    ...entry,
    logs,
    id: crypto.randomUUID(),
    at: Date.now(),
  };
  const next = [full, ...(await read())].slice(0, CAP);
  cache = next;
  await setJson(KEY, next);
  for (const fn of listeners) fn([...next]);
}

export async function clearApexHistory(): Promise<void> {
  cache = [];
  await setJson(KEY, []);
  for (const fn of listeners) fn([]);
}

/** Subscribe to history changes; returns an unsubscribe fn. */
export function onApexHistory(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
