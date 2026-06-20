import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ChevronRight } from "lucide-react";
import { configureMonacoApex } from "../monaco-apex";
import { RunButton } from "../components/RunButton";
import { LogView } from "../components/LogView";
import { DebugConfigRow } from "./DebugConfigRow";
import type { ApexOutcomeDto, CategoryLevels, DebugConfigDto } from "../types";
import type { SoqlDiagnosticDto } from "../types";
import type { ApexTab } from "../tabs/types";
import { useTheme, monacoTheme } from "../theme";

const EDITOR_OPTS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: 13,
  fontLigatures: true,
  renderLineHighlight: "all",
  scrollBeyondLastLine: false,
  padding: { top: 10 },
  lineNumbersMinChars: 3,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  overviewRulerLanes: 0,
};

/** A COMPILED / SUCCESS chip: success-green when true, red when false. */
function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        ok
          ? "border-success/40 text-success"
          : "border-red/40 text-red"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-red"}`}
      />
      {label}
    </span>
  );
}

interface ApexViewProps {
  tab: ApexTab;
  onPatch: (partial: Partial<ApexTab>) => void;
}

/** Anonymous-Apex runner (single tab): Monaco editor + status chips + error + debug log. */
export function ApexView({ tab, onPatch }: ApexViewProps) {
  const { theme } = useTheme();
  const { src, outcome, error, traceOpen } = tab;
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState<CategoryLevels | null>(null);
  const [cfgApplying, setCfgApplying] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);

  const srcRef = useRef(src);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  srcRef.current = src;

  useEffect(() => {
    invoke<DebugConfigDto>("get_debug_config")
      .then((dto) => setLevels(dto.levels))
      .catch((e) => setCfgError(typeof e === "string" ? e : String(e)));
  }, []);

  const applyConfig = useCallback(async (next: CategoryLevels) => {
    setCfgApplying(true);
    setCfgError(null);
    setLevels(next);
    try {
      const dto = await invoke<DebugConfigDto>("set_debug_config", {
        levels: next,
      });
      setLevels(dto.levels);
    } catch (e) {
      setCfgError(typeof e === "string" ? e : String(e));
    } finally {
      setCfgApplying(false);
    }
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    onPatch({ error: null });
    try {
      const dto = await invoke<ApexOutcomeDto>("run_apex", {
        src: srcRef.current,
      });
      onPatch({ outcome: dto });
    } catch (e) {
      onPatch({ error: typeof e === "string" ? e : String(e), outcome: null });
    } finally {
      setRunning(false);
    }
  }, [onPatch]);

  const beforeMount = (monaco: Monaco) => configureMonacoApex(monaco);
  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      run()
    );
  };

  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!instance || !monaco) return;
    const model = instance.getModel();
    if (!model) return;
    const handle = setTimeout(async () => {
      let diags: SoqlDiagnosticDto[];
      try {
        diags = await invoke<SoqlDiagnosticDto[]>("apex_soql_diagnostics", {
          src,
        });
      } catch {
        return;
      }
      monaco.editor.setModelMarkers(
        model,
        "apex-soql",
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
        })
      );
    }, 350);
    return () => clearTimeout(handle);
  }, [src]);

  return (
    <PanelGroup direction="vertical">
      <Panel defaultSize={45} minSize={20}>
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
            />
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />

      <Panel defaultSize={55} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="micro-label px-4 py-2">RESULT</div>

          {error ? (
            <pre className="mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
              {error}
            </pre>
          ) : !outcome ? (
            <div className="flex flex-1 items-center justify-center text-text-faint text-[13px]">
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
                <div className="rounded-[3px] border border-amber/40 bg-surface p-3 text-[12px] text-amber">
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
                <div className="rounded-[3px] border border-red/40 bg-surface p-3 text-[12px] text-red">
                  <span className="font-bold">
                    {outcome.exception_message ?? "Execution failed"}
                  </span>
                  {outcome.exception_stack_trace && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => onPatch({ traceOpen: !traceOpen })}
                        className="focus-accent inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-faint hover:text-text-dim cursor-pointer"
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
                        <pre className="mt-1 whitespace-pre-wrap text-[11px] text-text-faint">
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
                  <div className="min-h-0 flex-1 overflow-hidden rounded-[3px] border border-hair">
                    <LogView raw={outcome.logs} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-text-faint text-[13px]">
                    — no log —
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
}
