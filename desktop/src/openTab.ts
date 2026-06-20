/**
 * Tiny cross-panel channel for "open this text in a new <tool> tab". The target
 * tool's tab container may be unmounted when the request fires (only the active
 * panel is mounted), so the request is held as `pending` until the matching
 * container mounts and consumes it.
 */
export type OpenTool = "soql" | "apex";

let pending: { tool: OpenTool; text: string } | null = null;
const subs = new Set<(tool: OpenTool) => void>();

/** Ask the given tool to open `text` in a fresh tab. */
export function requestOpenTab(tool: OpenTool, text: string): void {
  pending = { tool, text };
  for (const fn of subs) fn(tool);
}

/** Take the pending text for `tool` if it matches; clears it. */
export function consumePending(tool: OpenTool): string | null {
  if (pending?.tool === tool) {
    const { text } = pending;
    pending = null;
    return text;
  }
  return null;
}

/** Subscribe to open requests; the callback receives the requested tool. */
export function onOpenTabRequest(fn: (tool: OpenTool) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
