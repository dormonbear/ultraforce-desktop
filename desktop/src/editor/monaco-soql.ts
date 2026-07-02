import type { Monaco } from "@monaco-editor/react";
import { formatSoql, soqlComplete } from "../ipc/soql";
import type { CompletionItemDto } from "../types";
import { limitInsertion } from "../components/soqlQuickfix";
import { configureEditorBase } from "./base";

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
  const icons: Record<string, number> = {
    object: K.Class,
    keyword: K.Keyword,
    function: K.Function,
    relationship: K.Reference,
  };
  return icons[kind] ?? K.Field;
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
        items = await soqlComplete(query, offset);
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
        formatted = await formatSoql(model.getValue());
      } catch {
        return [];
      }
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });
}

/** Register the editor highlight themes and a minimal `soql` language once. */
export function configureMonaco(monaco: Monaco): void {
  configureEditorBase(monaco);

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
