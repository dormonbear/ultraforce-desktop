import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Typed, debounced wrapper over tauri-plugin-store. One JSON file on disk
 * (appDataDir/ultraforce.json) holds all persisted app state. Values are
 * cached in memory; writes are coalesced so rapid edits (e.g. typing in a
 * tab) flush at most once per `DEBOUNCE_MS`.
 */
const FILE = "ultraforce.json";
const DEBOUNCE_MS = 400;

let storePromise: Promise<Store> | null = null;
function store(): Promise<Store> {
  // autoSave off — we control flushing via the debounce below.
  storePromise ??= load(FILE, { autoSave: false, defaults: {} });
  return storePromise;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Read a persisted value, or `fallback` when absent/unavailable. */
export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const s = await store();
    const v = await s.get<T>(key);
    return v ?? fallback;
  } catch {
    // Store unavailable (e.g. running outside Tauri / e2e without backend).
    return fallback;
  }
}

/** Persist a value, debounced per key. Resolves once the write is queued. */
export async function setJson<T>(key: string, value: T): Promise<void> {
  try {
    const s = await store();
    await s.set(key, value);
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void s.save();
      }, DEBOUNCE_MS),
    );
  } catch {
    // No-op when persistence is unavailable.
  }
}

/** Force an immediate flush of all pending writes (e.g. on window close). */
export async function flush(): Promise<void> {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  try {
    await (await store()).save();
  } catch {
    // ignore
  }
}
