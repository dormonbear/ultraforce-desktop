import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import type { CompletionItemDto } from "./types";

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
let soqlCompletionRegistered = false;

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

/** Register a SOQL CompletionItemProvider backed by the `soql_complete` Tauri command. */
export function registerSoqlCompletion(monaco: Monaco): void {
  if (soqlCompletionRegistered) return;
  soqlCompletionRegistered = true;
  monaco.languages.registerCompletionItemProvider("soql", {
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

/** Register the `sf` editor theme and a minimal `soql` language once. */
export function configureMonaco(monaco: Monaco): void {
  // Catppuccin Latte (light): mauve keywords, green strings, peach numbers.
  // Brand orange is kept for the caret only.
  monaco.editor.defineTheme("sf", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "8839ef", fontStyle: "bold" },
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
      "editorCursor.foreground": "#f54e00",
      "editorSuggestWidget.background": "#e6e9ef",
      "editorSuggestWidget.foreground": "#4c4f69",
      "editorSuggestWidget.border": "#ccd0da",
      "editorSuggestWidget.selectedBackground": "#ccd0da",
      "editorSuggestWidget.highlightForeground": "#1e66f5",
    },
  });

  // Catppuccin Mocha (dark): mauve keywords, green strings, peach numbers.
  monaco.editor.defineTheme("sf-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "cba6f7", fontStyle: "bold" },
      { token: "string.soql", foreground: "a6e3a1" },
      { token: "number.soql", foreground: "fab387" },
      { token: "comment.soql", foreground: "6c7086", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#1e1e2e",
      "editor.foreground": "#cdd6f4",
      "editorGutter.background": "#181825",
      "editorLineNumber.foreground": "#6c7086",
      "editorLineNumber.activeForeground": "#b4befe",
      "editor.selectionBackground": "#585b7066",
      "editor.lineHighlightBackground": "#31324466",
      "editorCursor.foreground": "#ff5a14",
      "editorSuggestWidget.background": "#181825",
      "editorSuggestWidget.foreground": "#cdd6f4",
      "editorSuggestWidget.border": "#313244",
      "editorSuggestWidget.selectedBackground": "#313244",
      "editorSuggestWidget.highlightForeground": "#89b4fa",
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
}
