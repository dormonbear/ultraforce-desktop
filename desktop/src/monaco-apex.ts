import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { configureMonaco } from "./monaco-soql";
import type { ApexCandidateDto } from "./types";

const APEX_KEYWORDS = [
  "System",
  "debug",
  "Integer",
  "String",
  "new",
  "for",
  "if",
  "return",
];

let registered = false;
let completionRegistered = false;

function monacoKind(monaco: Monaco, kind: string) {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "type":
      return K.Class;
    case "keyword":
      return K.Keyword;
    case "localVar":
      return K.Variable;
    case "method":
      return K.Method;
    case "property":
      return K.Field;
    default:
      return K.Text;
  }
}

/** Register an Apex CompletionItemProvider backed by the `apex_complete` Tauri command. */
export function registerApexCompletion(monaco: Monaco): void {
  if (completionRegistered) return;
  completionRegistered = true;
  monaco.languages.registerCompletionItemProvider("apex", {
    triggerCharacters: ["."],
    provideCompletionItems: async (model, position) => {
      const offset = model.getOffsetAt(position);
      const src = model.getValue();
      let cands: ApexCandidateDto[];
      try {
        cands = await invoke<ApexCandidateDto[]>("apex_complete", { src, offset });
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
        suggestions: cands.map((c) => ({
          label: c.label,
          kind: monacoKind(monaco, c.kind),
          insertText: c.label,
          range,
        })),
      };
    },
  });
}

/**
 * Ensure the shared `sf-dark` theme exists, then register a minimal `apex`
 * language with a handful of highlighted keywords. Reuses the SOQL token
 * scopes so the same theme colours apply.
 */
export function configureMonacoApex(monaco: Monaco): void {
  // Defines the `sf-dark` theme (idempotent re-register of theme + soql lang).
  configureMonaco(monaco);

  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "apex" });
  monaco.languages.setMonarchTokensProvider("apex", {
    keywords: APEX_KEYWORDS,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment.soql"],
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

  registerApexCompletion(monaco);
}
