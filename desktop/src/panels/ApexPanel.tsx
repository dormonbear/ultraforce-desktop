import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ChevronRight } from "lucide-react";
import { configureMonacoApex } from "../monaco-apex";
import { RunButton } from "../components/RunButton";
import { LogView } from "../components/LogView";
import type { ApexOutcomeDto } from "../types";

const DEFAULT_SRC = "System.debug('hello');";

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

/** A COMPILED / SUCCESS chip: accent when true, red when false. */
function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        ok
          ? "border-accent/40 text-accent"
          : "border-red/40 text-red"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-accent" : "bg-red"}`}
      />
      {label}
    </span>
  );
}

/** Anonymous-Apex runner: Monaco editor + status chips + error + debug log. */
export function ApexPanel() {
  const [src, setSrc] = useState(DEFAULT_SRC);
  const [outcome, setOutcome] = useState<ApexOutcomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);

  const srcRef = useRef(src);
  srcRef.current = src;

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const dto = await invoke<ApexOutcomeDto>("run_apex", {
        src: srcRef.current,
      });
      setOutcome(dto);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setOutcome(null);
    } finally {
      setRunning(false);
    }
  }, []);

  const beforeMount = (monaco: Monaco) => configureMonacoApex(monaco);
  const onMount: OnMount = (instance, monaco) => {
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      run()
    );
  };

  return (
    <PanelGroup direction="vertical">
      <Panel defaultSize={45} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="micro-label flex-1">ANONYMOUS APEX</div>
            <RunButton onRun={run} running={running} />
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              language="apex"
              theme="sf-dark"
              value={src}
              beforeMount={beforeMount}
              onMount={onMount}
              onChange={(v) => setSrc(v ?? "")}
              options={EDITOR_OPTS}
            />
          </div>
        </div>
      </Panel>

      <PanelResizeHandle className="h-px bg-line transition-colors data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent" />

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
                        onClick={() => setTraceOpen((o) => !o)}
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
