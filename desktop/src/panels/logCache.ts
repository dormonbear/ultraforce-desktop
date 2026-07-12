import { appDataDir } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { joinPath } from "../fs/paths";
import { getLog, parseLogView } from "../ipc/logs";
import type { LogRefDto, LogViewDto } from "../types";

// Salesforce debug logs are immutable once created, so a body cached by id is
// valid forever — reopening a previously-viewed log never re-downloads it.

const SUBDIR = ["workspace", "logcache"] as const;

/** Pure: the cache file path for a log id under `<appData>/workspace/logcache`. */
export function cacheFilePath(appData: string, id: string): string {
  return joinPath(appData, ...SUBDIR, `${id}.log`);
}

/** Resolve a log's parsed view: parse the locally cached body when present
 * (no org fetch), else download via `getLog` and write the body to cache. */
export async function loadLogView(
  id: string,
  deps: {
    readCache: (id: string) => Promise<string | null>;
    parse: (body: string) => Promise<LogViewDto>;
    getLog: (id: string) => Promise<LogViewDto>;
    writeCache: (id: string, body: string) => Promise<void>;
  },
): Promise<LogViewDto> {
  const cached = await deps.readCache(id);
  if (cached != null) return deps.parse(cached);
  const view = await deps.getLog(id);
  void deps.writeCache(id, view.raw);
  return view;
}

/** `loadLogView` bound to the real IPC + disk cache — the one production path
 * for resolving a log id to its parsed view. */
export function fetchLogView(id: string, org: string | null): Promise<LogViewDto> {
  return loadLogView(id, {
    readCache: readCachedBody,
    parse: parseLogView,
    getLog: (logId) => getLog(logId, org),
    writeCache: writeCachedBody,
  });
}

/** The set of log ids that have a cached body on disk (for a "downloaded"
 * marker in the list). Empty when the cache dir is missing / unreadable. */
export async function listCachedIds(): Promise<Set<string>> {
  try {
    const dir = joinPath(await appDataDir(), ...SUBDIR);
    if (!(await exists(dir))) return new Set();
    const entries = await readDir(dir);
    const ids = entries
      .filter((e) => e.isFile && e.name.endsWith(".log"))
      .map((e) => e.name.slice(0, -".log".length));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/** Read a cached log body, or null when not cached / unavailable. */
async function readCachedBody(id: string): Promise<string | null> {
  try {
    const path = cacheFilePath(await appDataDir(), id);
    if (!(await exists(path))) return null;
    return await readTextFile(path);
  } catch {
    return null;
  }
}

/** Persist a downloaded log body for instant reopen (best-effort). */
async function writeCachedBody(id: string, body: string): Promise<void> {
  try {
    const dir = joinPath(await appDataDir(), ...SUBDIR);
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(cacheFilePath(await appDataDir(), id), body);
  } catch {
    // Cache is best-effort; a write failure must not break opening the log.
  }
}

const listKey = (orgKey: string) => `logs.list.${orgKey}`;

/** Rows persisted before the camelCase rename carry snake_case keys. */
function migrateRow(r: LogRefDto): LogRefDto {
  const legacy = r as LogRefDto & {
    start_time?: string;
    duration_ms?: number;
    log_length?: number;
  };
  return {
    ...r,
    startTime: r.startTime ?? legacy.start_time ?? "",
    durationMs: r.durationMs ?? legacy.duration_ms ?? 0,
    logLength: r.logLength ?? legacy.log_length ?? 0,
  };
}

/** The persisted log list (head metadata) for an org, or [] when none. */
export async function loadCachedList(orgKey: string): Promise<LogRefDto[]> {
  return (await getJson<LogRefDto[]>(listKey(orgKey), [])).map(migrateRow);
}

/** Persist the log list (head metadata) for an org. */
export function saveCachedList(orgKey: string, rows: LogRefDto[]): Promise<void> {
  return setJson(listKey(orgKey), rows);
}
