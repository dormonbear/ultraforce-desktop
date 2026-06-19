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

/** Register the `sf-dark` theme and a minimal `soql` language once. */
export function configureMonaco(monaco: Monaco): void {
  monaco.editor.defineTheme("sf-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword.soql", foreground: "3ddc84", fontStyle: "bold" },
      { token: "string.soql", foreground: "6cb6ff" },
      { token: "number.soql", foreground: "ffb454" },
      { token: "comment.soql", foreground: "5c626d", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#111317",
      "editor.foreground": "#e6e8ec",
      "editorGutter.background": "#0a0b0d",
      "editorLineNumber.foreground": "#5c626d",
      "editorLineNumber.activeForeground": "#9aa0ab",
      "editor.selectionBackground": "#3ddc8433",
      "editor.lineHighlightBackground": "#16181d",
      "editorCursor.foreground": "#3ddc84",
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
