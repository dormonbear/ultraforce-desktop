import type { Monaco } from "@monaco-editor/react";
import type { IRange, languages } from "monaco-editor";
import { configureEditorBase } from "./base";
import { apexComplete, apexSignatureHelp, formatApex } from "../ipc/apex";
import type { ApexCandidateDto, ApexSignatureHelpDto } from "../types";
import { getActiveOrg } from "./activeOrg";
import { buildInsertion, KEYWORD_SNIPPETS, type Insertion, type InsertionCtx } from "./apexSuggest";

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

/** Suggestion ordering: in-scope vars/fields before methods, then types, then
 * keywords. Smaller sorts first; the label keeps it stable within a tier. */
const KIND_RANK: Record<string, string> = {
  localVar: "1",
  property: "2",
  method: "3",
  type: "4",
  constructor: "4",
  keyword: "5",
};

function monacoKind(monaco: Monaco, kind: string) {
  const K = monaco.languages.CompletionItemKind;
  const kinds: Record<string, number> = {
    type: K.Class,
    keyword: K.Keyword,
    localVar: K.Variable,
    method: K.Method,
    property: K.Field,
    constructor: K.Constructor,
  };
  return kinds[kind] ?? K.Text;
}

function candidateLabel(c: ApexCandidateDto): languages.CompletionItemLabel {
  return {
    label: c.label,
    detail: c.params ? `(${c.params.join(", ")})` : undefined,
    description: c.detail ?? undefined,
  };
}

function candidateCommand(ins: Insertion): languages.Command | undefined {
  return ins.triggerSignatureHelp
    ? { id: "editor.action.triggerParameterHints", title: "parameter hints" }
    : undefined;
}

/** One candidate → a Monaco completion item, using the shared insert-text builder. */
function toCompletionItem(
  monaco: Monaco,
  c: ApexCandidateDto,
  ctx: InsertionCtx,
  range: IRange,
): languages.CompletionItem {
  const ins = buildInsertion(c, ctx);
  return {
    label: candidateLabel(c),
    kind: monacoKind(monaco, c.kind),
    insertText: ins.insertText,
    insertTextRules: ins.isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    sortText: (KIND_RANK[c.kind] ?? "5") + c.label.toLowerCase(),
    command: candidateCommand(ins),
    range,
  };
}

function keywordSnippetItem(
  monaco: Monaco,
  s: (typeof KEYWORD_SNIPPETS)[string][number],
  range: IRange,
): languages.CompletionItem {
  return {
    label: { label: s.label, detail: ` ${s.detail}` },
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: s.body,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    sortText: "50" + s.label.toLowerCase(),
    range,
  };
}

/** Control-flow block snippets ride alongside their bare keyword ("50x" sorts
 * just above "5x", so the block is the preselected variant). */
function keywordBlockSuggestions(
  monaco: Monaco,
  cands: ApexCandidateDto[],
  range: IRange,
): languages.CompletionItem[] {
  return cands
    .filter((c) => c.kind === "keyword")
    .flatMap((c) => KEYWORD_SNIPPETS[c.label] ?? [])
    .map((s) => keywordSnippetItem(monaco, s, range));
}

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
        cands = await apexComplete(src, offset, getActiveOrg());
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
      const line = model.getLineContent(position.lineNumber);
      const ctx: InsertionCtx = {
        nextChar: line.slice(position.column - 1, position.column),
        lineBeforeWord: line.slice(0, word.startColumn - 1),
        lineAfterCursor: line.slice(position.column - 1),
      };
      const suggestions = cands.map((c) => toCompletionItem(monaco, c, ctx, range));
      suggestions.push(...keywordBlockSuggestions(monaco, cands, range));
      return { suggestions };
    },
  });
}

/** Map a DTO signature-help result into Monaco's `SignatureHelp` shape. */
function toSignatureHelpResult(help: ApexSignatureHelpDto): languages.SignatureHelpResult {
  return {
    value: {
      signatures: help.signatures.map((s) => ({
        label: s.label,
        parameters: s.params.map((p) => ({ label: p })),
      })),
      activeSignature: help.activeSignature,
      activeParameter: help.activeParameter,
    },
    dispose: () => {},
  };
}

/** Register signature help backed by `apex_signature_help`. Triggered by `(`/`,`
 * and by the completion items' triggerParameterHints command. HMR-safe. */
function registerApexSignatureHelp(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufApexSignatureHelp?.dispose();
  slot.__ufApexSignatureHelp = monaco.languages.registerSignatureHelpProvider("apex", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp: async (model, position) => {
      let help: ApexSignatureHelpDto | null;
      try {
        help = await apexSignatureHelp(
          model.getValue(),
          model.getOffsetAt(position),
          getActiveOrg(),
        );
      } catch {
        return null;
      }
      if (!help || help.signatures.length === 0) return null;
      return toSignatureHelpResult(help);
    },
  });
}

/** Register Format Document (Shift+Alt+F) for Apex, backed by `format_apex`. HMR-safe:
 * the previous provider (kept on the singleton monaco) is disposed before
 * re-registering, so a dev hot-reload can't stack providers. */
export function registerApexFormatter(monaco: Monaco): void {
  const slot = monaco as unknown as Record<string, { dispose(): void } | undefined>;
  slot.__ufApexFormatter?.dispose();
  slot.__ufApexFormatter = monaco.languages.registerDocumentFormattingEditProvider("apex", {
    provideDocumentFormattingEdits: async (model) => {
      let formatted: string;
      try {
        formatted = await formatApex(model.getValue());
      } catch {
        return [];
      }
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}

/**
 * Register the shared editor themes, then a minimal `apex` language with a
 * handful of highlighted keywords. Reuses the SOQL token scopes so the same
 * theme colours apply.
 */
export function configureMonacoApex(monaco: Monaco): void {
  configureEditorBase(monaco);

  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "apex" });
  monaco.languages.setLanguageConfiguration("apex", {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: "/**", close: " */", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'" },
    ],
  });
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
  registerApexSignatureHelp(monaco);
  registerApexFormatter(monaco);
}
