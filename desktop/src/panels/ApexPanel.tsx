import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ChevronRight, Loader2, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EDITOR_OPTS } from "../monaco-opts";
import { retriggerSuggestOnEdit } from "../monaco-retrigger";
import { trimContextMenu } from "../monaco-contextmenu";
import { useMonacoReveal, type Reveal } from "../monaco-reveal";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { configureMonacoApex, registerApexFormatter } from "../monaco-apex";
import { RunButton } from "../components/RunButton";
import { LogView } from "../components/LogView";
import { DebugConfigRow } from "./DebugConfigRow";
import { useDebugConfig } from "../useDebugConfig";
import { useOrgs } from "../org";
import { recordHistory } from "../history";
import { timing } from "../metrics";
import type { ApexOutcomeDto } from "../types";
import type { SoqlDiagnosticDto } from "../types";
import type { ApexTab } from "../tabs/types";
import { useTheme, monacoTheme } from "../theme";

/** A COMPILED / SUCCESS chip: success-green when true, destructive when false. */
function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Badge
      variant={ok ? "success" : "destructive"}
      className="text-[11px] uppercase tracking-wide"
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

  const run = useCallback(async () => {
    setRunning(true);
    onPatch({ error: null });
    const source = srcRef.current;
    const t0 = performance.now();
    try {
      const dto = await invoke<ApexOutcomeDto>("run_apex", { src: source });
      onPatch({ outcome: dto });
      if (!dto.compiled) {
        toast.error(dto.compile_problem ?? "Compile failed");
      } else if (!dto.success) {
        toast.error(dto.exception_message ?? "Execution failed");
      }
      const ms = performance.now() - t0;
      void timing("run.apex", ms);
      void recordHistory({
        tool: "apex",
        org,
        text: source,
        status: dto.compiled && dto.success ? "success" : "error",
        durationMs: ms,
      });
    } catch (e) {
      const message = typeof e === "string" ? e : String(e);
      toast.error(message);
      onPatch({ error: message, outcome: null });
      const ms = performance.now() - t0;
      void timing("run.apex", ms);
      void recordHistory({
        tool: "apex",
        org,
        text: source,
        status: "error",
        durationMs: ms,
      });
    } finally {
      setRunning(false);
    }
  }, [onPatch, org]);

  const beforeMount = (monaco: Monaco) => {
    configureMonacoApex(monaco);
    registerApexFormatter(monaco);
  };
  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      run()
    );
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      onSaveRef.current?.()
    );
    retriggerSuggestOnEdit(instance);
    trimContextMenu(instance);
    flushPending();
    setMounted(true);
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
    <ResizablePanelGroup direction="vertical">
      <ResizablePanel defaultSize={45} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="micro-label flex-1">ANONYMOUS APEX</div>
            <RunButton onRun={run} running={running} />
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
              options={EDITOR_OPTS}
              loading={
                <Loader2 size={18} className="spin text-muted-foreground" />
              }
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />

      <ResizablePanel defaultSize={55} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="micro-label px-4 py-2">RESULT</div>

          {error ? (
            <pre className="mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
              {error}
            </pre>
          ) : !outcome ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
              — run apex —
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
              {/* Status strip */}
              <div className="flex items-center gap-2">
                <StatusChip label="COMPILED" ok={outcome.compiled} />
                <StatusChip label="SUCCESS" ok={outcome.success} />
              </div>

              {/* Compile problem */}
              {!outcome.compiled && (
                <div className="rounded-md border border-amber/40 bg-card p-3 text-[12px] text-amber">
                  <span className="font-bold">
                    {outcome.compile_problem ?? "Compile failed"}
                  </span>
                  {outcome.line != null && (
                    <span className="tnum ml-2 text-amber/80">
                      Ln {outcome.line}:{outcome.column ?? 0}
                    </span>
                  )}
                </div>
              )}

              {/* Runtime exception */}
              {outcome.compiled && !outcome.success && (
                <div className="rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold">
                      {outcome.exception_message ?? "Execution failed"}
                    </span>
                    <button
                      type="button"
                      aria-label="Copy exception"
                      title="Copy the exception and stack trace"
                      onClick={async () => {
                        const text = [
                          outcome.exception_message,
                          outcome.exception_stack_trace,
                        ]
                          .filter(Boolean)
                          .join("\n");
                        try {
                          await navigator.clipboard.writeText(text);
                          toast.success("Exception copied");
                        } catch {
                          toast.error("Copy failed");
                        }
                      }}
                      className="focus-accent shrink-0 cursor-pointer rounded-[2px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  {outcome.exception_stack_trace && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => onPatch({ traceOpen: !traceOpen })}
                        className="focus-accent inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground hover:text-text-dim cursor-pointer"
                      >
                        <ChevronRight
                          size={12}
                          className={`transition-transform ${
                            traceOpen ? "rotate-90" : ""
                          }`}
                        />
                        stack trace
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
                <div className="micro-label pb-1">DEBUG LOG</div>
                {outcome.logs ? (
                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                    <LogView raw={outcome.logs} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
                    — no log —
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
