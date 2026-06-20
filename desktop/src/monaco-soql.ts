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
  // Cursor editorial light theme: ink keywords, success-green strings, gold numbers,
  // orange cursor. Code stays restrained — orange is reserved for the caret only.
  monaco.editor.defineTheme("sf", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "26251e", fontStyle: "bold" },
      { token: "string.soql", foreground: "1f8a65" },
      { token: "number.soql", foreground: "c08532" },
      { token: "comment.soql", foreground: "807d72", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#fafaf7",
      "editor.foreground": "#26251e",
      "editorGutter.background": "#f7f7f4",
      "editorLineNumber.foreground": "#a09c92",
      "editorLineNumber.activeForeground": "#5a5852",
      "editor.selectionBackground": "#f54e0022",
      "editor.lineHighlightBackground": "#f1f0ea",
      "editorCursor.foreground": "#f54e00",
    },
  });

  // Warm-dark counterpart (matches the app's [data-theme="dark"] palette).
  monaco.editor.defineTheme("sf-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "f2f1ec", fontStyle: "bold" },
      { token: "string.soql", foreground: "3fb488" },
      { token: "number.soql", foreground: "d9a23f" },
      { token: "comment.soql", foreground: "8c887d", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#211f1b",
      "editor.foreground": "#f2f1ec",
      "editorGutter.background": "#1a1916",
      "editorLineNumber.foreground": "#8c887d",
      "editorLineNumber.activeForeground": "#bdb9ae",
      "editor.selectionBackground": "#ff5a1433",
      "editor.lineHighlightBackground": "#26241f",
      "editorCursor.foreground": "#ff5a14",
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
