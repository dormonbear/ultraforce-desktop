/** Dev-only startup timing. `performance.now()` is measured from page load, so
 * the numbers are directly comparable run to run — use them to check a startup
 * change actually moved, rather than guessing. The Rust side logs the
 * process-start → window-ready half (see lib.rs). */
export function markStartup(name: string) {
  if (!import.meta.env.DEV) return;
  console.info(`[startup] ${name} ${Math.round(performance.now())}ms`);
}
