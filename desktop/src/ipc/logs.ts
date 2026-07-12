import { invoke } from "@tauri-apps/api/core";
import type { LogRefDto, LogViewDto } from "../types";
import type { SourceRef } from "../panels/sourceRef";
import type { DebugFrame, DebugSession } from "../panels/stepDebug";

/** Head metadata of `org`'s debug logs, newest first (null = CLI default). */
export function listLogs(org: string | null): Promise<LogRefDto[]> {
  return invoke<LogRefDto[]>("list_logs", { org });
}

/** Download a log body from `org` and parse it (raw included; null = CLI default). */
export function getLog(id: string, org: string | null): Promise<LogViewDto> {
  return invoke<LogViewDto>("get_log", { id, org });
}

/** Parse a log body already held in memory into a full `LogViewDto`.
 * `parse_log` omits `raw` by design (no 16MB echo over IPC); this re-attaches
 * the body we already hold. */
export async function parseLogView(body: string): Promise<LogViewDto> {
  const parsed = await invoke<Omit<LogViewDto, "raw">>("parse_log", { body });
  return { raw: body, ...parsed };
}

/** Raw-line indices in `body` that resolve to Apex source. */
export function sourceLineIndices(body: string): Promise<number[]> {
  return invoke<number[]>("source_line_indices", { body });
}

/** Resolve one raw line to an Apex source location, or null. */
export function sourceAtLine(body: string, line: number): Promise<SourceRef | null> {
  return invoke<SourceRef | null>("source_at_line", { body, line });
}

/** Build the offline step-debug replay outline for a log body. */
export function debugSession(raw: string): Promise<DebugSession> {
  return invoke<DebugSession>("debug_session", { raw });
}

/** Call stack + variables at one stop point of the replay. */
export function debugFramesAt(
  raw: string,
  unitIndex: number,
  entryIndex: number,
): Promise<DebugFrame[]> {
  return invoke<DebugFrame[]>("debug_frames_at", { raw, unitIndex, entryIndex });
}
