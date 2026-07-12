import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { soqlSubquerySpans } from "../ipc/soql";

/** A 1-based Monaco-style position. */
export interface SpanPosition {
  lineNumber: number;
  column: number;
}

/** Text bounds of one line, Monaco-convention: 1-based columns, `0` when the
 * line is empty or whitespace-only (mirrors `getLineFirstNonWhitespaceColumn` /
 * `getLineLastNonWhitespaceColumn`). `lastNonWhitespaceColumn` is the column
 * AFTER the last non-whitespace character. */
export interface LineTextBounds {
  firstNonWhitespaceColumn: number;
  lastNonWhitespaceColumn: number;
}

export interface LineRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Split a multi-line span into per-line ranges trimmed to actual text, so the
 * decoration never tints leading indentation (closing `)` lines, wrapped
 * continuation lines) or trailing whitespace. Whitespace-only lines inside the
 * span are skipped entirely. Pure: positions in, ranges out.
 */
export function splitSpanIntoLineRanges(
  start: SpanPosition,
  end: SpanPosition,
  boundsForLine: (lineNumber: number) => LineTextBounds,
): LineRange[] {
  const ranges: LineRange[] = [];
  for (let line = start.lineNumber; line <= end.lineNumber; line++) {
    const bounds = boundsForLine(line);
    if (bounds.firstNonWhitespaceColumn === 0) continue; // whitespace-only line
    const spanStart = line === start.lineNumber ? start.column : 1;
    const spanEnd = line === end.lineNumber ? end.column : Infinity;
    const startColumn = Math.max(spanStart, bounds.firstNonWhitespaceColumn);
    const endColumn = Math.min(spanEnd, bounds.lastNonWhitespaceColumn);
    if (endColumn <= startColumn) continue;
    ranges.push({
      startLineNumber: line,
      startColumn,
      endLineNumber: line,
      endColumn,
    });
  }
  return ranges;
}

/**
 * Fetch the inner subquery `(SELECT … )` ranges for `value` and paint them as a
 * faint background on `editorInstance` via the given decorations collection.
 * Each span becomes one or more per-line ranges trimmed to actual text (see
 * `splitSpanIntoLineRanges`) so leading indentation is never tinted.
 *
 * The collection is created once per editor instance (see `SoqlEditor`) and
 * lives for the editor's lifetime — `.set()` atomically replaces its contents,
 * so calling this repeatedly on edit swaps decorations without stacking, and an
 * empty result clears them with no flicker (HMR-safe: no module state). IPC
 * failures clear silently rather than toasting on every keystroke.
 */
export async function applySubqueryDecorations(
  monaco: Monaco,
  editorInstance: editor.IStandaloneCodeEditor,
  value: string,
  collection: editor.IEditorDecorationsCollection,
): Promise<void> {
  let spans;
  try {
    spans = await soqlSubquerySpans(value);
  } catch {
    collection.clear();
    return;
  }
  const model = editorInstance.getModel();
  if (!model) {
    collection.clear();
    return;
  }
  const boundsForLine = (lineNumber: number): LineTextBounds => ({
    firstNonWhitespaceColumn: model.getLineFirstNonWhitespaceColumn(lineNumber),
    lastNonWhitespaceColumn: model.getLineLastNonWhitespaceColumn(lineNumber),
  });
  const decorations = spans.flatMap((s) =>
    splitSpanIntoLineRanges(
      model.getPositionAt(s.start),
      model.getPositionAt(s.end),
      boundsForLine,
    ).map((r) => ({
      range: new monaco.Range(
        r.startLineNumber,
        r.startColumn,
        r.endLineNumber,
        r.endColumn,
      ),
      options: { className: "soql-subquery-range" },
    })),
  );
  collection.set(decorations);
}
