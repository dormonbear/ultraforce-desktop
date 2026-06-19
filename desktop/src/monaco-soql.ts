import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";

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

/** Register a SOQL CompletionItemProvider backed by the `soql_complete` Tauri command. */
export function registerSoqlCompletion(monaco: Monaco): void {
  if (soqlCompletionRegistered) return;
  soqlCompletionRegistered = true;
  monaco.languages.registerCompletionItemProvider("soql", {
    triggerCharacters: [" ", ",", "."],
    provideCompletionItems: async (model, position) => {
      const offset = model.getOffsetAt(position);
      const query = model.getValue();
      let labels: string[];
      try {
        labels = await invoke<string[]>("soql_complete", { query, offset });
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
        suggestions: labels.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: label,
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
