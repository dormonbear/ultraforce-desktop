import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CornerLeftUp,
  CornerRightDown,
  Loader2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { configureMonacoApex } from "../editor/monaco-apex";
import { EDITOR_OPTS } from "../editor/monaco-opts";
import { useTheme, monacoTheme } from "../theme";
import { useOrgs } from "../org";
import { revealLine, useApexSource } from "./useApexSource";
import { debugFramesAt, debugSession } from "../ipc/logs";
import {
  nextFn,
  prevFn,
  stepInto,
  stepOut,
  stepOver,
  stepPrev,
  type DebugFrame,
  type DebugSession,
} from "../panels/stepDebug";

/** Offline step-debugger over a parsed debug log: fetches the replay session for
 * one execution unit, then steps through executed source lines with a Monaco
 * source view, a call stack, and per-frame variables. */
export function LogDebugger({
  raw,
  open,
  onClose,
}: {
  raw: string;
  open: boolean;
  onClose: () => void;
}) {
  const { theme, scheme } = useTheme();
  const [session, setSession] = useState<DebugSession | null>(null);
  const [i, setI] = useState(0);
  // Call stack for the current step, fetched on demand (kept off the outline so
  // opening over a large log stays cheap).
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  // Which frame's source is shown; null = the top (innermost) frame.
  const [frameSel, setFrameSel] = useState<number | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Build the lightweight replay outline whenever the debugger opens for a log.
  useEffect(() => {
    if (!open) return;
    setSession(null);
    setI(0);
    setFrames([]);
    setFrameSel(null);
    let alive = true;
    debugSession(raw)
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession({ steps: [], hasVariables: false }));
    return () => {
      alive = false;
    };
  }, [open, raw]);

  const steps = session?.steps ?? [];
  const step = steps[i] ?? null;

  // Fetch the current step's call stack + variables on demand.
  useEffect(() => {
    if (!open || !step) {
      setFrames([]);
      return;
    }
    let alive = true;
    debugFramesAt(raw, step.unitIndex, step.entryIndex)
      .then((f) => {
        if (alive) {
          setFrames(f);
          setFrameSel(null);
        }
      })
      .catch(() => alive && setFrames([]));
    return () => {
      alive = false;
    };
  }, [open, raw, step?.unitIndex, step?.entryIndex]);

  const topIdx = frames.length - 1;
  const frameIdx = frameSel ?? topIdx;
  const frame = frames[frameIdx] ?? null;
  const { selected: org } = useOrgs();
  const { src, error } = useApexSource(frame?.className ?? null, org);
  const hasVars = session?.hasVariables ?? false;

  // Reveal the active frame's line on step/frame/source change.
  useEffect(() => {
    revealLine(editorRef.current, frame?.line ?? null);
  }, [src, frame?.line]);

  const onMount: OnMount = (instance) => {
    editorRef.current = instance;
    revealLine(instance, frame?.line ?? null);
  };

  // A step move re-fetches frames (which resets the selected frame to the top).
  const go = (next: number) => setI(next);

  const atStart = i <= 0;
  const atEnd = i >= steps.length - 1;
  const controls: [string, React.ReactNode, () => void, boolean][] = [
    ["First", <SkipBack size={15} />, () => go(0), atStart],
    ["Previous function", <ChevronsLeft size={15} />, () => go(prevFn(steps, i)), atStart],
    ["Previous", <ChevronLeft size={15} />, () => go(stepPrev(steps, i)), atStart],
    ["Step out", <CornerLeftUp size={15} />, () => go(stepOut(steps, i)), atEnd],
    ["Step", <ChevronRight size={15} />, () => go(stepInto(steps, i)), atEnd],
    ["Step over", <CornerRightDown size={15} />, () => go(stepOver(steps, i)), atEnd],
    ["Next function", <ChevronsRight size={15} />, () => go(nextFn(steps, i)), atEnd],
    ["Last", <SkipForward size={15} />, () => go(steps.length - 1), atEnd],
  ];

  return (
    <Dialog
      isOpen={open}
      onOpenChange={(o) => !o && onClose()}
      width="85vw"
      maxHeight="85vh"
    >
      <DialogHeader
        title="Debug"
        subtitle={
          step
            ? `${frame?.signature} · line ${frame?.line ?? "—"} · step ${i + 1}/${steps.length}`
            : undefined
        }
        onOpenChange={(o) => !o && onClose()}
      />
      <div className="flex h-[72vh] flex-col gap-3">

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          {controls.map(([label, icon, onClick, disabled]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={onClick}
              disabled={disabled || steps.length === 0}
              className="focus-accent flex h-7 w-7 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {icon}
            </button>
          ))}
        </div>

        {!session && (
          <div className="flex items-center gap-2 py-6 text-[13px] text-text-dim">
            <Loader2 className="spin" size={16} /> Building session…
          </div>
        )}
        {session && steps.length === 0 && (
          <div className="py-6 text-[13px] text-text-dim">
            No executable source lines in this log unit.
          </div>
        )}

        {session && steps.length > 0 && (
          <div className="flex min-h-0 flex-1 gap-3">
            {/* Source */}
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border">
              {error ? (
                <div className="p-3 text-[12px] text-destructive">{error}</div>
              ) : (
                <Editor
                  height="100%"
                  language="apex"
                  theme={monacoTheme(theme, scheme)}
                  value={src?.body ?? ""}
                  beforeMount={(monaco: Monaco) => configureMonacoApex(monaco)}
                  onMount={onMount}
                  options={{ ...EDITOR_OPTS, readOnly: true, lineNumbers: "on" }}
                  loading={<Loader2 size={18} className="spin text-muted-foreground" />}
                />
              )}
            </div>

            {/* Call stack + variables */}
            <div className="flex w-72 shrink-0 flex-col gap-3">
              <Panel title="Call stack">
                {/* Innermost frame first (top of stack). */}
                {frames.map((_f, k) => frames.length - 1 - k).map((idx) => {
                  const f = frames[idx];
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setFrameSel(idx)}
                      className={`flex w-full flex-col items-start rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-primary/10 ${
                        idx === frameIdx ? "bg-primary/15 text-primary" : "text-foreground"
                      }`}
                    >
                      <span className="truncate">{f.signature}</span>
                      <span className="text-[11px] text-text-dim">
                        line {f.line ?? "—"}
                      </span>
                    </button>
                  );
                })}
              </Panel>

              <Panel title="Variables">
                {!hasVars ? (
                  <p className="px-2 py-1 text-[11px] text-text-dim">
                    Variable values need a log captured at APEX_CODE=FINEST.
                  </p>
                ) : frame && frame.variables.length > 0 ? (
                  frame.variables.map((v) => (
                    <div key={v.name} className="px-2 py-1 text-[12px]">
                      <span className="text-foreground">{v.name}</span>
                      {v.typeName && (
                        <span className="text-text-dim"> ({v.typeName})</span>
                      )}
                      <span className="text-text-dim"> = </span>
                      <span className="break-all text-foreground">{v.value || "—"}</span>
                    </div>
                  ))
                ) : (
                  <p className="px-2 py-1 text-[11px] text-text-dim">
                    No variables in scope.
                  </p>
                )}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
      <div className="border-b border-border px-2 py-1 text-[11.5px] font-semibold text-muted-foreground">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">{children}</div>
    </div>
  );
}
