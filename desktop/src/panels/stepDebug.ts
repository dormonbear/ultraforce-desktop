import type { SourceRef } from "./sourceRef";

/** A variable visible in a frame at a step. */
export interface DebugVar {
  name: string;
  typeName: string | null;
  value: string;
}

/** One call-stack frame at a step. */
export interface DebugFrame {
  className: string;
  line: number | null;
  signature: string;
  variables: DebugVar[];
}

/** One stop point (lightweight). Its call stack + variables are fetched on
 * demand via `debug_frames_at(unitIndex, entryIndex)`. */
export interface DebugStep {
  unitIndex: number;
  entryIndex: number;
  source: SourceRef;
  depth: number;
  /** True when this stop opens a new function (method / constructor / code
   * unit) — drives function-level "next/prev function" stepping. */
  isFrameStart: boolean;
}

/** The replay outline: ordered stop points plus whether the log carries any
 * variable data (so the UI can prompt for FINEST when it doesn't). */
export interface DebugSession {
  steps: DebugStep[];
  hasVariables: boolean;
}

const clamp = (i: number, steps: DebugStep[]): number =>
  Math.max(0, Math.min(i, steps.length - 1));

/** Step into: advance to the very next stop point (may be a deeper frame). */
export function stepInto(steps: DebugStep[], i: number): number {
  return clamp(i + 1, steps);
}

/** Step back: retreat one stop point. */
export function stepPrev(steps: DebugStep[], i: number): number {
  return clamp(i - 1, steps);
}

/** Step over: skip deeper frames, landing on the next step at or above the
 * current depth. Runs to the end if none follows. */
export function stepOver(steps: DebugStep[], i: number): number {
  const depth = steps[i]?.depth ?? 0;
  for (let j = i + 1; j < steps.length; j++) {
    if (steps[j].depth <= depth) return j;
  }
  return clamp(steps.length - 1, steps);
}

/** Step out: run until the current frame returns — the next step at a shallower
 * depth. Runs to the end if none follows. */
export function stepOut(steps: DebugStep[], i: number): number {
  const depth = steps[i]?.depth ?? 0;
  for (let j = i + 1; j < steps.length; j++) {
    if (steps[j].depth < depth) return j;
  }
  return clamp(steps.length - 1, steps);
}

/** Next function: jump to the next step that opens a function (method /
 * constructor / code unit), skipping statements within the current one. Runs to
 * the end if none follows. */
export function nextFn(steps: DebugStep[], i: number): number {
  for (let j = i + 1; j < steps.length; j++) {
    if (steps[j].isFrameStart) return j;
  }
  return clamp(steps.length - 1, steps);
}

/** Previous function: jump back to the previous function-opening step. Stays at
 * the start if none precedes. */
export function prevFn(steps: DebugStep[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j].isFrameStart) return j;
  }
  return clamp(0, steps);
}
