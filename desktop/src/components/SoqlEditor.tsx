import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Loader2 } from "lucide-react";
import { configureMonaco, registerSoqlFormatter } from "../editor/monaco-soql";
import { soqlDiagnostics } from "../ipc/soql";
import { retriggerSuggestOnEdit } from "../editor/monaco-retrigger";
import { useMonacoReveal, type Reveal } from "../editor/monaco-reveal";
import { EDITOR_OPTS } from "../editor/monaco-opts";
import { trimContextMenu } from "../editor/monaco-contextmenu";
import { diagnosticsToMarkers } from "../editor/monaco-markers";
import type { SoqlDiagnosticDto } from "../types";
import { RunButton } from "./RunButton";
import { useTheme, monacoTheme } from "../theme";
import { useOrgs } from "../org";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave?: () => void;
  running: boolean;
  reveal?: Reveal;
}

export function SoqlEditor({
  value,
  onChange,
  onRun,
  onSave,
  running,
  reveal,
}: Props) {
  const { theme, scheme } = useTheme();
  const { selected: org } = useOrgs();
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // Flips once the editor has mounted so the diagnostics effect runs on first
  // open (editorRef is null on the initial render, before onMount).
  const [mounted, setMounted] = useState(false);
  onRunRef.current = onRun;
  onSaveRef.current = onSave;
  const { flushPending } = useMonacoReveal(editorRef, reveal);

  function beforeMount(monaco: Monaco) {
    configureMonaco(monaco);
    registerSoqlFormatter(monaco);
  }

  const onMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;
    // addAction (not addCommand) scopes each keybinding to this editor instance
    // via an `editorId == this.getId()` precondition, so the SOQL shortcuts only
    // fire when this editor is focused — not in a focused Apex tab.
    editorInstance.addAction({
      id: "uf.runSoqlQuery",
      label: "Run Query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunRef.current(),
    });
    editorInstance.addAction({
      id: "uf.saveSoql",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current?.(),
    });
    retriggerSuggestOnEdit(editorInstance);
    trimContextMenu(editorInstance);
    flushPending();
    setMounted(true);
    // Focus so a freshly opened/created tab is ready to type into.
    editorInstance.focus();
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
        diags = await soqlDiagnostics(value, org);
      } catch {
        return;
      }
      monaco.editor.setModelMarkers(
        model,
        "soql",
        diagnosticsToMarkers(monaco, model, diags),
      );
    }, 350);
    return () => clearTimeout(handle);
  }, [value, mounted, org]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="micro-label flex-1">Query</div>
        <RunButton onRun={onRun} running={running} />
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language="soql"
          theme={monacoTheme(theme, scheme)}
          value={value}
          beforeMount={beforeMount}
          onMount={onMount}
          onChange={(v) => onChange(v ?? "")}
          options={{
            ...EDITOR_OPTS,
            placeholder: "SELECT Id, Name FROM Account WHERE …",
          }}
          loading={<Loader2 size={18} className="spin text-muted-foreground" />}
        />
      </div>
    </div>
  );
}
