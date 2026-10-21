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
const inFlight = new Map<string, Promise<void>>();
const failures = new Map<string, unknown>();
let mutations = 0;
let mutationTail: Promise<void> = Promise.resolve();
const flushes = new Set<{ path: string | null | undefined }>();

/** Serialize writes per path; different files can still write in parallel. */
function enqueue(path: string, content: string): Promise<void> {
  const previous = inFlight.get(path) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(() => writer(path, content));
  inFlight.set(path, write);
  // Observe background failures without an unhandled rejection, and keep them
  // visible to explicit Save/flush until a later write succeeds for this path.
  void write.then(
    () => {
      failures.delete(path);
      if (inFlight.get(path) === write) inFlight.delete(path);
    },
    (error: unknown) => {
      failures.set(path, error);
      if (inFlight.get(path) === write) inFlight.delete(path);
    },
  );
  return write;
}

/** Queue a write for `path`, coalescing rapid edits per path. */
export function saveFile(path: string, content: string): void {
  pending.set(path, content);
  const prev = timers.get(path);
  if (prev) clearTimeout(prev);
  timers.set(
    path,
    setTimeout(() => {
      if (mutations > 0) return;
      const c = pending.get(path);
      timers.delete(path);
      pending.delete(path);
      if (c != null) void enqueue(path, c);
    }, DEBOUNCE_MS),
  );
}

/** Start pending writes immediately and wait for all outstanding writes. */
async function flushNow(
  matches: (path: string) => boolean = () => true,
): Promise<void> {
  for (const [path, content] of pending) {
    if (!matches(path)) continue;
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    pending.delete(path);
    enqueue(path, content);
  }
  await Promise.allSettled(
    [...inFlight].filter(([path]) => matches(path)).map(([, write]) => write),
  );
  for (const [path, error] of failures) if (matches(path)) throw error;
}

/** Flush one path (following moves), or all paths; null means it was deleted. */
export async function flushFiles(
  path?: string,
): Promise<string | null | undefined> {
  const request: { path: string | null | undefined } = { path };
  flushes.add(request);
  const wait = async (): Promise<void> => {
    const barrier = mutationTail;
    await barrier;
    // Another mutation can be registered while this flush is waiting.
    if (barrier !== mutationTail) return wait();
    if (request.path !== null) {
      await flushNow(
        request.path === undefined
          ? undefined
          : (candidate) => candidate === request.path,
      );
    }
    if (barrier !== mutationTail) return wait();
  };
  try {
    await wait();
    return request.path;
  } finally {
    flushes.delete(request);
  }
}

/** Explicit writes share the autosave queue and replace older pending content. */
export async function writeFileNow(
  path: string,
  content: string,
): Promise<string> {
  saveFile(path, content);
  const destination = await flushFiles(path);
  if (destination === null)
    throw new Error("File was deleted while saving. Choose another path.");
  return destination ?? path;
}

function redirectPending(from: string, to: string | null): void {
  // Snapshot before inserting redirected paths into the same map.
  const buffered = [...pending];
  for (const [path, content] of buffered) {
    if (path !== from && !path.startsWith(`${from}/`)) continue;
    pending.delete(path);
    const timer = timers.get(path);
    if (timer) clearTimeout(timer);
    timers.delete(path);
    if (to !== null) pending.set(to + path.slice(from.length), content);
  }
}

function redirectFlushes(from: string, to: string | null): void {
  for (const request of flushes) {
    const path = request.path;
    if (path && (path === from || path.startsWith(`${from}/`))) {
      request.path = to === null ? null : to + path.slice(from.length);
    }
  }
}

/** Freeze autosaves across a path mutation, then redirect edits made during IO.
 * The callback publishes new tab paths before buffered writes resume.
 */
export function mutateFiles(
  from: string,
  to: string | null,
  operation: () => Promise<void>,
  changed: () => void = () => {},
): Promise<void> {
  mutations += 1;
  const result = mutationTail
    .then(async () => {
      await flushNow(
        (path) =>
          path === from ||
          path.startsWith(`${from}/`) ||
          (to !== null && (path === to || path.startsWith(`${to}/`))),
      );
      await operation();
      redirectPending(from, to);
      redirectFlushes(from, to);
      changed();
    })
    .finally(() => {
      mutations -= 1;
      if (mutations === 0) {
        for (const [path, content] of pending) saveFile(path, content);
      }
    });
  mutationTail = result.catch(() => {});
  return result;
}
