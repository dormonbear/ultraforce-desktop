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
let apexFormatRegistered = false;

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

/** Built-in Apex generics → snippet body that drops the cursor inside `<>`. */
const GENERIC_SNIPPETS: Record<string, string> = {
  List: "List<$0>",
  Set: "Set<$0>",
  Map: "Map<$1, $2>",
  Iterable: "Iterable<$0>",
  Iterator: "Iterator<$0>",
};

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
        suggestions: cands.map((c) => {
          const snippet = GENERIC_SNIPPETS[c.label];
          return {
            label: c.label,
            kind: monacoKind(monaco, c.kind),
            insertText: snippet ?? c.label,
            insertTextRules: snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range,
          };
        }),
      };
    },
  });
}

/** Register Format Document (Shift+Alt+F) for Apex, backed by `format_apex`. */
export function registerApexFormatter(monaco: Monaco): void {
  if (apexFormatRegistered) return;
  apexFormatRegistered = true;
  monaco.languages.registerDocumentFormattingEditProvider("apex", {
    provideDocumentFormattingEdits: async (model) => {
      let formatted: string;
      try {
        formatted = await invoke<string>("format_apex", {
          src: model.getValue(),
        });
      } catch {
        return [];
      }
      return [{ range: model.getFullModelRange(), text: formatted }];
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
