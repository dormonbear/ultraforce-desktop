import type { ApexCandidateDto } from "../types";

/** Built-in Apex generics → snippet body that drops the cursor inside `<>`. */
const GENERIC_SNIPPETS: Record<string, string> = {
  List: "List<$0>",
  Set: "Set<$0>",
  Map: "Map<$1, $2>",
  Iterable: "Iterable<$0>",
  Iterator: "Iterator<$0>",
};

export interface InsertionCtx {
  /** Character directly after the caret ("" at end of line). */
  nextChar: string;
  /** Line text before the word being completed (includes the receiver chain). */
  lineBeforeWord: string;
  /** Line text from the caret to end of line. */
  lineAfterCursor: string;
}

export interface Insertion {
  insertText: string;
  isSnippet: boolean;
  /** Pop parameter hints after accepting (methods with params). */
  triggerSignatureHelp: boolean;
}

/** Statement position: nothing but the receiver chain before the word on this
 * line. ponytail: line-local heuristic, not syntax-aware — chains containing
 * calls or preceded by any expression text fall out as non-statement, so the
 * semicolon is only ever added in the unambiguous case. */
export function isStatementPosition(lineBeforeWord: string): boolean {
  return lineBeforeWord.replace(/[\w.$]*$/, "").trim() === "";
}

const plain = (label: string): Insertion => ({
  insertText: label,
  isSnippet: false,
  triggerSignatureHelp: false,
});

/** Insert-text for one candidate, mirroring rust-analyzer's fill-arguments
 * defaults: methods get placeholder-arg call snippets (skipped when the caret
 * already faces a paren), void methods in statement position carry the
 * semicolon inside the snippet (addSemicolonToUnit), constructors get parens. */
export function buildInsertion(c: ApexCandidateDto, ctx: InsertionCtx): Insertion {
  const generic = GENERIC_SNIPPETS[c.label];
  if (c.kind === "constructor") {
    if (ctx.nextChar === "(" || ctx.nextChar === "<") return plain(c.label);
    return {
      insertText: generic ? `${c.label}<$1>($2)$0` : `${c.label}($1)$0`,
      isSnippet: true,
      triggerSignatureHelp: false,
    };
  }
  if (c.kind === "method" && c.params) {
    if (ctx.nextChar === "(") return plain(c.label);
    const isVoid = (c.detail ?? "").toLowerCase() === "void";
    const semi =
      isVoid && isStatementPosition(ctx.lineBeforeWord) && ctx.lineAfterCursor.trim() === ""
        ? ";"
        : "";
    const args = c.params.map((p, i) => `\${${i + 1}:${p}}`).join(", ");
    return {
      insertText: `${c.label}(${args})${semi}$0`,
      isSnippet: true,
      triggerSignatureHelp: c.params.length > 0,
    };
  }
  if (generic) return { insertText: generic, isSnippet: true, triggerSignatureHelp: false };
  return plain(c.label);
}

export interface KeywordSnippet {
  label: string;
  detail: string;
  body: string;
}

/** Control-flow block snippets offered alongside the bare keywords. */
export const KEYWORD_SNIPPETS: Record<string, KeywordSnippet[]> = {
  if: [{ label: "if", detail: "if block", body: "if ($1) {\n\t$0\n}" }],
  for: [
    {
      label: "for",
      detail: "for (i) block",
      body: "for (Integer ${1:i} = 0; ${1:i} < ${2:size}; ${1:i}++) {\n\t$0\n}",
    },
    {
      label: "for",
      detail: "for (each : collection) block",
      body: "for (${1:SObject} ${2:item} : ${3:collection}) {\n\t$0\n}",
    },
  ],
  while: [{ label: "while", detail: "while block", body: "while ($1) {\n\t$0\n}" }],
  try: [
    {
      label: "try",
      detail: "try / catch block",
      body: "try {\n\t$0\n} catch (${1:Exception} e) {\n\t\n}",
    },
  ],
};
