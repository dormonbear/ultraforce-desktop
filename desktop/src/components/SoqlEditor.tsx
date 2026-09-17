import { useEffect, useRef, useState } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Loader2 } from "lucide-react";
import { configureMonaco, registerSoqlFormatter } from "../editor/monaco-soql";
import { applySubqueryDecorations } from "../editor/soqlSubqueryHighlight";
import { soqlDiagnostics } from "../ipc/soql";
import { retriggerSuggestOnEdit } from "../editor/monaco-retrigger";
import { useMonacoReveal, type Reveal } from "../editor/monaco-reveal";
import { EDITOR_OPTS } from "../editor/monaco-opts";
import { trimContextMenu } from "../editor/monaco-contextmenu";
import { diagnosticsToMarkers } from "../editor/monaco-markers";
import type { SoqlDiagnosticDto } from "../types";
import { RunButton } from "./RunButton";
import { TargetOrg } from "./TargetOrg";
import { useTheme, monacoTheme } from "../theme";
import { useOrgs } from "../org";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave?: () => void;
  running: boolean;
  reveal?: Reveal;
  /** Route this query through the Tooling API instead of the Data API. */
  useToolingApi: boolean;
  onToggleToolingApi: () => void;
  /** Include deleted/archived rows (queryAll). */
  allRows: boolean;
  onToggleAllRows: () => void;
}

/**
 * A run-option toggle. These live beside Run (not in the results header) because
 * they change how the NEXT run executes — unlike Explain, which switches what
 * the finished result shows.
 */
function RunOption({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[12px] transition-colors ${
        on ? "bg-primary/15 text-primary" : "text-text-dim hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/** Header strip: what this query runs against, how it will run, and Run itself. */
function QueryToolbar({
  useToolingApi,
  onToggleToolingApi,
  allRows,
  onToggleAllRows,
  onRun,
  running,
}: Pick<
  Props,
  | "useToolingApi"
  | "onToggleToolingApi"
  | "allRows"
  | "onToggleAllRows"
  | "onRun"
  | "running"
>) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="micro-label">Query</span>
        <TargetOrg />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <RunOption
          label="Tooling API"
          on={useToolingApi}
          onClick={onToggleToolingApi}
        />
        <RunOption label="All rows" on={allRows} onClick={onToggleAllRows} />
        <RunButton onRun={onRun} running={running} />
      </div>
    </div>
  );
}

// Size is the Monaco wiring below (mount actions, diagnostics, decorations),
// which predates the toolbar split above and wants its own hook — a refactor
// with real HMR/disposable risk, not something to bundle into a release.
// fallow-ignore-next-line complexity
export function SoqlEditor({
  value,
  onChange,
  onRun,
  onSave,
  running,
  reveal,
  useToolingApi,
  onToggleToolingApi,
  allRows,
  onToggleAllRows,
}: Props) {
  const { theme, scheme } = useTheme();
  const { selected: org } = useOrgs();
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const subqueryDecorations = useRef<editor.IEditorDecorationsCollection | null>(
    null,
  );
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
    subqueryDecorations.current = editorInstance.createDecorationsCollection();
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

  // Faint background highlight on inner `(SELECT … )` subquery ranges. Debounced
  // so it doesn't fire on every keystroke; also runs once on mount.
  useEffect(() => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    const collection = subqueryDecorations.current;
    if (!editorInstance || !monaco || !collection) return;
    const handle = setTimeout(() => {
      void applySubqueryDecorations(monaco, editorInstance, value, collection);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, mounted]);

  return (
    <div className="flex h-full flex-col">
      <QueryToolbar
        useToolingApi={useToolingApi}
        onToggleToolingApi={onToggleToolingApi}
        allRows={allRows}
        onToggleAllRows={onToggleAllRows}
        onRun={onRun}
        running={running}
      />
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
