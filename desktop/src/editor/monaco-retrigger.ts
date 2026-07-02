import type { editor } from "monaco-editor";

/** True when the edit removed characters (typing/paste never re-trigger). */
function isDeletion(e: editor.IModelContentChangedEvent): boolean {
  return e.changes.some((c) => c.text === "" && c.rangeLength > 0);
}

/** Re-open the popup only when the cursor sits right after a word character. */
function retriggerInWord(ed: editor.IStandaloneCodeEditor): void {
  const model = ed.getModel();
  const pos = ed.getPosition();
  if (!model || !pos) return;
  if (model.getWordUntilPosition(pos).word.length === 0) return;
  ed.trigger("suggest", "editor.action.triggerSuggest", {});
}

/**
 * Re-open the completion widget after a deletion. Monaco auto-triggers
 * suggestions while typing but NOT after backspace/delete, so the popup vanishes
 * once you remove characters (e.g. `FROM acc` → backspace → no list). Re-trigger
 * only on deletions (typing already triggers, so re-triggering there would just
 * cause flicker) and only when the cursor sits right after a word character.
 */
export function retriggerSuggestOnEdit(
  ed: editor.IStandaloneCodeEditor,
): void {
  ed.onDidChangeModelContent((e) => {
    if (isDeletion(e)) retriggerInWord(ed);
  });
}
