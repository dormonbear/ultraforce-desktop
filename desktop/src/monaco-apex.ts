import type { Monaco } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { configureMonaco } from "./monaco-soql";
import type { ApexCandidateDto } from "./types";

// Apex is case-insensitive; the tokenizer matches with `ignoreCase`.
const APEX_KEYWORDS = [
  // declarations & modifiers
  "class", "interface", "enum", "extends", "implements", "public", "private",
  "protected", "global", "static", "final", "virtual", "abstract", "override",
  "transient", "with", "without", "inherited", "sharing", "testmethod",
  "get", "set",
  // control flow
  "void", "return", "if", "else", "for", "while", "do", "break", "continue",
  "new", "this", "super", "try", "catch", "finally", "throw", "instanceof",
  "switch", "on", "when", "null", "true", "false",
  // DML
  "insert", "update", "delete", "undelete", "upsert", "merge", "runas",
  // inline SOQL/SOSL keywords
  "select", "from", "where", "limit", "order", "by", "group", "having", "and",
  "or", "not", "like", "in", "asc", "desc", "nulls", "first", "last", "offset",
];

const APEX_TYPES = [
  "Integer", "Long", "Decimal", "Double", "Boolean", "String", "Id", "Date",
  "Datetime", "Time", "Blob", "Object", "SObject", "List", "Set", "Map",
];

let registered = false;
let apexFormatRegistered = false;

/** Suggestion ordering: in-scope vars/fields before methods, then types, then
 * keywords. Smaller sorts first; the label keeps it stable within a tier. */
const KIND_RANK: Record<string, string> = {
  localVar: "1",
  property: "2",
  method: "3",
  type: "4",
  keyword: "5",
};

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

/** Register an Apex CompletionItemProvider backed by the `apex_complete` Tauri command.
 * HMR-safe: the disposable is kept on the (singleton) monaco instance and the
 * previous provider is disposed first, so a dev hot-reload can't stack providers
 * (which would duplicate every suggestion). */
function registerApexCompletion(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufApexCompletion?.dispose();
  slot.__ufApexCompletion = monaco.languages.registerCompletionItemProvider("apex", {
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
            sortText: (KIND_RANK[c.kind] ?? "5") + c.label.toLowerCase(),
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
    ignoreCase: true,
    keywords: APEX_KEYWORDS,
    typeKeywords: APEX_TYPES,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment.soql"],
        [/\/\*/, "comment.soql", "@comment"],
        [/@\w+/, "keyword.soql"],
        [/'(?:[^'\\]|\\.)*'/, "string.soql"],
        [/\b\d+(\.\d+)?\b/, "number.soql"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword.soql",
              "@typeKeywords": "type.soql",
              "@default": "identifier",
            },
          },
        ],
      ],
      comment: [
        [/[^/*]+/, "comment.soql"],
        [/\*\//, "comment.soql", "@pop"],
        [/[/*]/, "comment.soql"],
      ],
    },
  });

  registerApexCompletion(monaco);
}
