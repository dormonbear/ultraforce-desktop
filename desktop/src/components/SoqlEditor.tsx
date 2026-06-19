import { useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { configureMonaco } from "../monaco-soql";
import { RunButton } from "./RunButton";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  running: boolean;
}

export function SoqlEditor({ value, onChange, onRun, running }: Props) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  function beforeMount(monaco: Monaco) {
    configureMonaco(monaco);
  }

  const onMount: OnMount = (editorInstance, monaco) => {
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRunRef.current()
    );
  };

  const options: editor.IStandaloneEditorConstructionOptions = {
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
          theme="sf-dark"
          value={value}
          beforeMount={beforeMount}
          onMount={onMount}
          onChange={(v) => onChange(v ?? "")}
          options={options}
        />
      </div>
    </div>
  );
}
