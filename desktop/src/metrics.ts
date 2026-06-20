import { getJson, setJson } from "./store";

/**
 * Lightweight client-side metrics: monotonic counters plus a rolling window
 * of the most recent run durations. Persisted to the store so a "Metrics"
 * debug view can render counts across sessions. Not telemetry — nothing
 * leaves the machine.
 */
export interface Metrics {
  counters: Record<string, number>;
  /** Last DURATION_WINDOW durations (ms), newest last, keyed by event. */
  durations: Record<string, number[]>;
}

const KEY = "metrics";
const DURATION_WINDOW = 50;
const EMPTY: Metrics = { counters: {}, durations: {} };

let cache: Metrics | null = null;

async function read(): Promise<Metrics> {
  cache ??= await getJson<Metrics>(KEY, structuredClone(EMPTY));
  return cache;
}

/** Increment a named counter (default +1). */
export async function bump(event: string, by = 1): Promise<void> {
  const m = await read();
  m.counters[event] = (m.counters[event] ?? 0) + by;
  await setJson(KEY, m);
}

/** Record a duration sample and bump the matching counter. */
export async function timing(event: string, ms: number): Promise<void> {
  const m = await read();
  m.counters[event] = (m.counters[event] ?? 0) + 1;
  const arr = m.durations[event] ?? [];
  arr.push(Math.round(ms));
  m.durations[event] = arr.slice(-DURATION_WINDOW);
  await setJson(KEY, m);
}

export async function readMetrics(): Promise<Metrics> {
  return structuredClone(await read());
}
