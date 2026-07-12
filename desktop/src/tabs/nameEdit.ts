/**
 * Selection end for renaming a filename: the stem length (the index of the
 * last extension dot), so overtyping the preselected name keeps the extension.
 * A leading dot with no other dot (dotfile, e.g. ".env") selects the whole name.
 */
export function stemSelectionEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

/** What a tab-rename request resolves to. */
export type RenameIntent =
  | { kind: "done"; ok: boolean } // nothing to write; `ok` = close the editor?
  | { kind: "title"; name: string } // untitled tab: retitle in memory
  | { kind: "file"; name: string }; // saved tab: rename the backing file

/**
 * Classify a rename request. Empty → reject (keep the editor open); unchanged →
 * a no-op that closes the editor; an untitled tab (no path) renames its
 * in-memory title; otherwise the backing file is renamed on disk.
 */
export function renameIntent(
  raw: string,
  currentTitle: string,
  path: string,
): RenameIntent {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "done", ok: false };
  if (trimmed === currentTitle) return { kind: "done", ok: true };
  if (path === "") return { kind: "title", name: trimmed };
  return { kind: "file", name: trimmed };
}
