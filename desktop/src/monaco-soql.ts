import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import type { CompletionItemDto } from "./types";
import { limitInsertion } from "./components/soqlQuickfix";

const SOQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "LIMIT",
  "ORDER",
  "BY",
  "AND",
  "OR",
  "NOT",
  "GROUP",
  "HAVING",
  "ASC",
  "DESC",
  "NULL",
  "LIKE",
  "IN",
  "OFFSET",
];

let registered = false;

/** Map a backend completion kind to a Monaco icon. */
function kindIcon(
  monaco: Monaco,
  kind: string,
): number {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "object":
      return K.Class;
    case "keyword":
      return K.Keyword;
    case "function":
      return K.Function;
    case "relationship":
      return K.Reference;
    default:
      return K.Field;
  }
}

/** Register a SOQL CompletionItemProvider backed by the `soql_complete` Tauri command.
 * HMR-safe: dispose the previous provider (kept on the singleton monaco) before
 * re-registering, so a dev hot-reload can't stack providers (duplicate suggestions). */
function registerSoqlCompletion(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufSoqlCompletion?.dispose();
  slot.__ufSoqlCompletion = monaco.languages.registerCompletionItemProvider("soql", {
    triggerCharacters: [" ", ",", "."],
    provideCompletionItems: async (model, position) => {
      const offset = model.getOffsetAt(position);
      const query = model.getValue();
      let items: CompletionItemDto[];
      try {
        items = await invoke<CompletionItemDto[]>("soql_complete", {
          query,
          offset,
        });
      } catch {
        return { suggestions: [] };
      }
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          detail: item.detail ?? undefined,
          kind: kindIcon(monaco, item.kind),
          insertText: item.label,
          range,
        })),
      };
    },
  });
}

/** Register a "Add LIMIT 200" quickfix for the no-LIMIT warning marker. HMR-safe. */
function registerSoqlQuickfix(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufSoqlQuickfix?.dispose();
  slot.__ufSoqlQuickfix = monaco.languages.registerCodeActionProvider("soql", {
    provideCodeActions: (model, _range, context) => {
      const actions = context.markers
        .filter((m) => m.message.includes("LIMIT"))
        .map((marker) => {
          const { offset, text } = limitInsertion(model.getValue());
          const pos = model.getPositionAt(offset);
          return {
            title: "Add LIMIT 200",
            diagnostics: [marker],
            kind: "quickfix",
            isPreferred: true,
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: new monaco.Range(
                      pos.lineNumber,
                      pos.column,
                      pos.lineNumber,
                      pos.column,
                    ),
                    text,
                  },
                },
              ],
            },
          };
        });
      return { actions, dispose: () => {} };
    },
  });
}

/** Register Format Document (Shift+Alt+F) for SOQL, backed by `format_soql`. HMR-safe. */
export function registerSoqlFormatter(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufSoqlFormatter?.dispose();
  slot.__ufSoqlFormatter = monaco.languages.registerDocumentFormattingEditProvider("soql", {
    provideDocumentFormattingEdits: async (model) => {
      let formatted: string;
      try {
        formatted = await invoke<string>("format_soql", {
          query: model.getValue(),
        });
      } catch {
        return [];
      }
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}

/** Register the `sf` editor theme and a minimal `soql` language once. */
export function configureMonaco(monaco: Monaco): void {
  // Catppuccin Latte (light): mauve keywords, green strings, peach numbers.
  // Brand blue is kept for the caret only.
  monaco.editor.defineTheme("sf", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "8839ef", fontStyle: "bold" },
      { token: "type.soql", foreground: "179299" },
      { token: "string.soql", foreground: "40a02b" },
      { token: "number.soql", foreground: "fe640b" },
      { token: "comment.soql", foreground: "9ca0b0", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#eff1f5",
      "editor.foreground": "#4c4f69",
      "editorGutter.background": "#e6e9ef",
      "editorLineNumber.foreground": "#9ca0b0",
      "editorLineNumber.activeForeground": "#4c4f69",
      "editor.selectionBackground": "#acb0be66",
      "editor.lineHighlightBackground": "#ccd0da66",
      "editorCursor.foreground": "#0176d3",
      "editorSuggestWidget.background": "#e6e9ef",
      "editorSuggestWidget.foreground": "#4c4f69",
      "editorSuggestWidget.border": "#ccd0da",
      "editorSuggestWidget.selectedBackground": "#ccd0da",
      "editorSuggestWidget.highlightForeground": "#1e66f5",
      "menu.background": "#ffffff",
      "menu.foreground": "#4c4f69",
      "menu.border": "#ccd0da",
      "menu.separatorBackground": "#e6e9ef",
      "menu.selectionBackground": "#e6e9ef",
      "menu.selectionForeground": "#4c4f69",
    },
  });

  // Cool-neutral dark tuned to the app's Salesforce palette: blue caret/selection,
  // One Dark-ish syntax that reads calmly on the #16181d background.
  monaco.editor.defineTheme("sf-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "c792ea", fontStyle: "bold" },
      { token: "type.soql", foreground: "56b6c2" },
      { token: "string.soql", foreground: "98c379" },
      { token: "number.soql", foreground: "d19a66" },
      { token: "comment.soql", foreground: "5b626d", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#16181d",
      "editor.foreground": "#e9eaee",
      "editorGutter.background": "#16181d",
      "editorLineNumber.foreground": "#4d5560",
      "editorLineNumber.activeForeground": "#aeb4be",
      "editor.selectionBackground": "#1b96ff33",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorCursor.foreground": "#1b96ff",
      "editorSuggestWidget.background": "#1e2127",
      "editorSuggestWidget.foreground": "#e9eaee",
      "editorSuggestWidget.border": "#2a2e36",
      "editorSuggestWidget.selectedBackground": "#2b2f37",
      "editorSuggestWidget.highlightForeground": "#1b96ff",
      // Right-click context menu — match the app's Radix dropdowns.
      "menu.background": "#1e2127",
      "menu.foreground": "#e9eaee",
      "menu.border": "#2a2e36",
      "menu.separatorBackground": "#2a2e36",
      "menu.selectionBackground": "#2b2f37",
      "menu.selectionForeground": "#e9eaee",
    },
  });

  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "soql" });
  monaco.languages.setMonarchTokensProvider("soql", {
    ignoreCase: true,
    keywords: SOQL_KEYWORDS,
    tokenizer: {
      root: [
        [/--.*$/, "comment.soql"],
        [/'[^']*'/, "string.soql"],
        [/\b\d+(\.\d+)?\b/, "number.soql"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword.soql",
              "@default": "identifier",
            },
          },
        ],
      ],
    },
  });

  registerSoqlCompletion(monaco);
  registerSoqlQuickfix(monaco);
  registerSoqlFormatter(monaco);
}
