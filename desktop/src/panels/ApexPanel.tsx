import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ChevronRight, Loader2, Copy, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EDITOR_OPTS } from "../monaco-opts";
import { retriggerSuggestOnEdit } from "../monaco-retrigger";
import { trimContextMenu } from "../monaco-contextmenu";
import { copyText } from "../clipboard";
import { parseSfError, isCliUnavailable } from "../errorFormat";
import { CliGuidanceForError } from "../components/CliGuidance";
import { SfErrorDetail } from "../components/SfErrorDetail";
import { useMonacoReveal, type Reveal } from "../monaco-reveal";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { configureMonacoApex, registerApexFormatter } from "../monaco-apex";
import { RunButton } from "../components/RunButton";
import { LogView } from "../components/LogView";
import { ApexHistoryDrawer } from "../components/ApexHistoryDrawer";
import { recordApexRun } from "../apexHistory";
import { DebugConfigRow } from "./DebugConfigRow";
import { useDebugConfig } from "../useDebugConfig";
import { useOrgs } from "../org";
import { timing } from "../metrics";
import type { ApexOutcomeDto } from "../types";
import type { SoqlDiagnosticDto } from "../types";
import type { ApexTab } from "../tabs/types";
import { useTheme, monacoTheme } from "../theme";

/** A Compiled / Success chip: success-green when true, destructive when false. */
function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Badge
      variant={ok ? "success" : "destructive"}
      className="text-[11px]"
    >
      {label}
    </Badge>
  );
}

interface ApexViewProps {
  tab: ApexTab;
  onPatch: (partial: Partial<ApexTab>) => void;
  onSave?: () => void;
  reveal?: Reveal;
}

/** Anonymous-Apex runner (single tab): Monaco editor + status chips + error + debug log. */
export function ApexView({ tab, onPatch, onSave, reveal }: ApexViewProps) {
  const { theme } = useTheme();
  const { selected: org } = useOrgs();
  const { src, outcome, error, traceOpen } = tab;
  const [running, setRunning] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    levels,
    applying: cfgApplying,
    error: cfgError,
    apply: applyConfig,
  } = useDebugConfig(org);

  const srcRef = useRef(src);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // Flips once the editor has mounted so the diagnostics effect runs on first
  // open (editorRef is null on the initial render, before onMount).
  const [mounted, setMounted] = useState(false);
  srcRef.current = src;
  const { flushPending } = useMonacoReveal(editorRef, reveal);
  // Persist the editor/result split across launches (matches the SOQL panel).
  const layout = useDefaultLayout({
    id: "uf-apex-split",
    panelIds: ["editor", "result"],
    storage: localStorage,
  });

  const run = useCallback(async () => {
    if (!srcRef.current.trim()) {
      toast.error("Write some Apex to run");
      return;
    }
    setRunning(true);
    onPatch({ error: null });
    const source = srcRef.current;
    const t0 = performance.now();
    try {
      const dto = await invoke<ApexOutcomeDto>("run_apex", { src: source });
      onPatch({ outcome: dto });
      void recordApexRun({
        org,
        source,
        logs: dto.logs ?? "",
        compiled: dto.compiled,
        success: dto.success,
        exception_message: dto.exception_message,
      });
      if (!dto.compiled) {
        toast.error(dto.compile_problem ?? "Compile failed");
      } else if (!dto.success) {
        toast.error(dto.exception_message ?? "Execution failed");
      }
      const ms = performance.now() - t0;
      void timing("run.apex", ms);
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      toast.error(parseSfError(message).detail);
      onPatch({ error: message, outcome: null });
      const ms = performance.now() - t0;
      void timing("run.apex", ms);
    } finally {
      setRunning(false);
    }
  }, [onPatch, org]);
  // Keep the Monaco Ctrl+Enter command (bound once at mount) calling the latest
  // run closure, so keyboard runs record the current org (not the mount-time one).
  const runRef = useRef(run);
  runRef.current = run;

  const beforeMount = (monaco: Monaco) => {
    configureMonacoApex(monaco);
    registerApexFormatter(monaco);
  };
  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      runRef.current()
    );
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current?.()
    );
    retriggerSuggestOnEdit(instance);
    trimContextMenu(instance);
    flushPending();
    setMounted(true);
    // Focus so a freshly opened/created tab is ready to type into.
    instance.focus();
  };

  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!instance || !monaco) return;
    const model = instance.getModel();
    if (!model) return;
    const handle = setTimeout(async () => {
      const toMarkers = (diags: SoqlDiagnosticDto[]) =>
        diags.map((d) => {
          const s = model.getPositionAt(d.start);
          const e = model.getPositionAt(d.end);
          return {
            message: d.message,
            severity:
              d.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Error,
            startLineNumber: s.lineNumber,
            startColumn: s.column,
            endLineNumber: e.lineNumber,
            endColumn: e.column,
          } as editor.IMarkerData;
        });
      // SOQL-in-Apex diagnostics + AST diagnostics (duplicate vars, unknown
      // fields) as separate marker owners so each refreshes independently.
      try {
        const soql = await invoke<SoqlDiagnosticDto[]>("apex_soql_diagnostics", {
          src,
        });
        monaco.editor.setModelMarkers(model, "apex-soql", toMarkers(soql));
      } catch {
        /* ignore */
      }
      try {
        const ast = await invoke<SoqlDiagnosticDto[]>("apex_diagnostics", {
          src,
        });
        monaco.editor.setModelMarkers(model, "apex-ast", toMarkers(ast));
      } catch {
        /* ignore */
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [src, mounted]);

  return (
    <>
    <ResizablePanelGroup
      direction="vertical"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel id="editor" defaultSize={45} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="micro-label flex-1">Anonymous Apex</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Execution history"
                title="Execution history"
                onClick={() => setHistoryOpen(true)}
                className="focus-accent inline-flex size-7 items-center justify-center rounded-md text-text-dim hover:bg-accent hover:text-foreground cursor-pointer"
              >
                <History size={15} />
              </button>
              <RunButton onRun={run} running={running} />
            </div>
          </div>
          {levels && (
            <DebugConfigRow
              value={levels}
              onApply={applyConfig}
              applying={cfgApplying}
              error={cfgError}
            />
          )}
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language="apex"
              theme={monacoTheme(theme)}
              value={src}
              beforeMount={beforeMount}
              onMount={onMount}
              onChange={(v) => onPatch({ src: v ?? "" })}
              options={{
                ...EDITOR_OPTS,
                placeholder: "System.debug('Hello, World');",
              }}
              loading={
                <Loader2 size={18} className="spin text-muted-foreground" />
              }
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />

      <ResizablePanel id="result" defaultSize={55} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="micro-label px-4 py-2">Result</div>

          {error && isCliUnavailable(error) ? (
            <CliGuidanceForError onRetry={run} />
          ) : error ? (
            <SfErrorDetail error={error} className="mx-4 mb-4" />
          ) : !outcome ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
              Run to see results
            </div>
          ) : (
            <div className="select-text flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
              {/* Status strip */}
              <div className="flex items-center gap-2">
                <StatusChip label="Compiled" ok={outcome.compiled} />
                <StatusChip label="Success" ok={outcome.success} />
              </div>

              {/* Compile problem */}
              {!outcome.compiled && (
                <div className="rounded-md border border-amber/40 bg-card p-3 text-[12px] text-amber">
                  <span className="font-medium">
                    {outcome.compile_problem ?? "Compile failed"}
                  </span>
                  {outcome.line != null && (
                    <button
                      type="button"
                      title="Jump to this location in the editor"
                      onClick={() => {
                        const ed = editorRef.current;
                        if (!ed || outcome.line == null) return;
                        ed.revealLineInCenter(outcome.line);
                        ed.setPosition({
                          lineNumber: outcome.line,
                          column: Math.max(1, outcome.column ?? 1),
                        });
                        ed.focus();
                      }}
                      className="tnum ml-2 cursor-pointer text-amber/80 underline-offset-2 hover:underline"
                    >
                      Ln {outcome.line}:{outcome.column ?? 0}
                    </button>
                  )}
                </div>
              )}

              {/* Runtime exception */}
              {outcome.compiled && !outcome.success && (
                <div className="rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">
                      {outcome.exception_message ?? "Execution failed"}
                    </span>
                    <button
                      type="button"
                      aria-label="Copy exception"
                      title="Copy the exception and stack trace"
                      onClick={() =>
                        void copyText(
                          [
                            outcome.exception_message,
                            outcome.exception_stack_trace,
                          ]
                            .filter(Boolean)
                            .join("\n"),
                          "Exception copied",
                        )
                      }
                      className="focus-accent shrink-0 cursor-pointer rounded-md text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  {outcome.exception_stack_trace && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => onPatch({ traceOpen: !traceOpen })}
                        className="focus-accent inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-text-dim cursor-pointer"
                      >
                        <ChevronRight
                          size={12}
                          className={`transition-transform ${
                            traceOpen ? "rotate-90" : ""
                          }`}
                        />
                        Stack trace
                      </button>
                      {traceOpen && (
                        <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                          {outcome.exception_stack_trace}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Debug log */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="micro-label pb-1">Debug log</div>
                {outcome.logs ? (
                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                    <LogView raw={outcome.logs} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
                    No debug log
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
    <ApexHistoryDrawer
      open={historyOpen}
      onOpenChange={setHistoryOpen}
      onLoad={(source) => {
        if (src.trim() && !window.confirm("Replace the current editor content?"))
          return;
        onPatch({ src: source });
      }}
    />
    </>
  );
}
