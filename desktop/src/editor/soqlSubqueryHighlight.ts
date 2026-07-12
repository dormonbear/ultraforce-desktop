import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { soqlSubquerySpans } from "../ipc/soql";

/**
 * Fetch the inner subquery `(SELECT … )` ranges for `value` and paint them as a
 * faint background on `editorInstance` via the given decorations collection.
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
  const decorations = spans.map((s) => {
    const start = model.getPositionAt(s.start);
    const end = model.getPositionAt(s.end);
    return {
      range: new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      ),
      options: { className: "soql-subquery-range" },
    };
  });
  collection.set(decorations);
}
