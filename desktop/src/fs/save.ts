import { writeTextFile } from "@tauri-apps/plugin-fs";

const DEBOUNCE_MS = 400;
type Writer = (path: string, content: string) => Promise<void>;

let writer: Writer = (p, c) => writeTextFile(p, c);
/** Test seam. */
export function __setWriter(fn: Writer): void {
  writer = fn;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, string>();

/** Queue a write for `path`, coalescing rapid edits per path. */
export function saveFile(path: string, content: string): void {
  pending.set(path, content);
  const prev = timers.get(path);
  if (prev) clearTimeout(prev);
  timers.set(
    path,
    setTimeout(() => {
      const c = pending.get(path);
      timers.delete(path);
      pending.delete(path);
      if (c != null) void writer(path, c);
    }, DEBOUNCE_MS),
  );
}

/** Flush all pending writes immediately. */
export async function flushFiles(): Promise<void> {
  const entries = [...pending.entries()];
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  pending.clear();
  await Promise.all(entries.map(([p, c]) => writer(p, c)));
}
