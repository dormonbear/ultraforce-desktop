import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Loader2 } from "lucide-react";
import { configureMonaco } from "../monaco-soql";
import { retriggerSuggestOnEdit } from "../monaco-retrigger";
import { useMonacoReveal, type Reveal } from "../monaco-reveal";
import { EDITOR_OPTS } from "../monaco-opts";
import type { SoqlDiagnosticDto } from "../types";
import { RunButton } from "./RunButton";
import { useTheme, monacoTheme } from "../theme";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  running: boolean;
  reveal?: Reveal;
}

export function SoqlEditor({ value, onChange, onRun, running, reveal }: Props) {
  const { theme } = useTheme();
  const onRunRef = useRef(onRun);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  onRunRef.current = onRun;
  const { flushPending } = useMonacoReveal(editorRef, reveal);

  function beforeMount(monaco: Monaco) {
    configureMonaco(monaco);
  }

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRunRef.current()
    );
    retriggerSuggestOnEdit(editorInstance);
    flushPending();
  };

  useEffect(() => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorInstance || !monaco) return;
    const model = editorInstance.getModel();
    if (!model) return;
    const handle = setTimeout(async () => {
      let diags: SoqlDiagnosticDto[];
      try {
        diags = await invoke<SoqlDiagnosticDto[]>("soql_diagnostics", {
          query: value,
        });
      } catch {
        return;
      }
      monaco.editor.setModelMarkers(
        model,
        "soql",
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
          };
        })
      );
    }, 350);
    return () => clearTimeout(handle);
  }, [value]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="micro-label flex-1">QUERY</div>
        <RunButton onRun={onRun} running={running} />
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="soql"
          theme={monacoTheme(theme)}
          value={value}
          beforeMount={beforeMount}
          onMount={onMount}
          onChange={(v) => onChange(v ?? "")}
          options={EDITOR_OPTS}
          loading={<Loader2 size={18} className="spin text-muted-foreground" />}
        />
      </div>
    </div>
  );
}
