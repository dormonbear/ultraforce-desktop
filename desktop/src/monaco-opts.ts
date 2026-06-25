import type { editor } from "monaco-editor";

/** Shared Monaco editor options for the SOQL + Apex editors. */
export const EDITOR_OPTS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  fontSize: 13,
  fontLigatures: true,
  renderLineHighlight: "all",
  scrollBeyondLastLine: false,
  padding: { top: 2 },
  lineNumbersMinChars: 3,
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  overviewRulerLanes: 0,
};
