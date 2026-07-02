import type { editor } from "monaco-editor";

/** Context-menu action ids that are noise for a SOQL/Apex query tool. */
const HIDDEN_IDS = new Set([
  "editor.action.changeAll", // Change All Occurrences (⌘F2)
  "editor.action.quickCommand", // Command Palette (F1)
]);

/**
 * Remove unhelpful entries from Monaco's right-click menu, keeping Format
 * Document and the clipboard actions.
 *
 * ponytail: hooks the internal `editor.contrib.contextmenu` contribution —
 * Monaco has no public API to remove built-in menu items. If a Monaco upgrade
 * renames `_getMenuActions`, the menu silently falls back to the full default.
 */
export function trimContextMenu(
  instance: editor.IStandaloneCodeEditor
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contrib = instance.getContribution("editor.contrib.contextmenu") as any;
  const orig = contrib?._getMenuActions;
  if (typeof orig !== "function") return;
  contrib._getMenuActions = function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orig
      .apply(contrib, args)
      .filter((action: any) => !HIDDEN_IDS.has(action?.id));
  };
}
