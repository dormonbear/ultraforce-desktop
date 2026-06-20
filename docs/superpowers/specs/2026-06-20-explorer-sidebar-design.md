# Explorer Sidebar + File-Backed Tabs — Design

**Date:** 2026-06-20
**Status:** Approved, implementing

## Problem

SOQL and Anonymous Apex are managed today by per-tool tab strips only
(`useTabs` + `tabs.soql`/`tabs.apex` JSON blobs in the Tauri store). With many
scripts this does not scale — there is no folder organization and every tab's
full content lives in one JSON file. We want VSCode-style management: a
left-hand file-explorer sidebar with folders of real script files.

## Decisions (locked)

- **Storage:** real files on disk (`*.soql`, `*.apex`), not virtual JSON nodes.
- **Trees:** two separate trees — one for SOQL, one for Apex. The activity rail
  keeps `SOQL / Apex / Logs`.
- **Editor:** keep VSCode-style tabs; the tree is the organizer, double-click
  opens a tab, multiple tabs allowed.
- **Workspace root:** managed default, changeable in settings.
- **Save:** debounced autosave to disk (no dirty state, no Cmd+S).
- **File ops:** new file/folder, rename, delete, drag-to-move.

## Filesystem layout

- Default root: `appDataDir/workspace/` with `soql/` and `apex/` subdirs.
- Override path per tool persisted in store: `workspace.soql.path`,
  `workspace.apex.path` (absolute path; absent ⇒ managed default).
- Files are `*.soql` / `*.apex`, plain text. Folders nest arbitrarily.

## Tauri plugins (new)

- `tauri-plugin-fs` + `@tauri-apps/plugin-fs` — read/write/list/mkdir/rename/remove.
- `tauri-plugin-dialog` + `@tauri-apps/plugin-dialog` — folder picker for
  "change workspace root".
- `capabilities/default.json` gains `fs` (scoped to `$APPDATA/workspace/**` plus
  any user-chosen root) and `dialog` permissions, registered in `lib.rs`.

## Modules (new, small & focused)

- `fs/workspace.ts` (~80 lines) — resolve/create the two workspace roots,
  change-root, persist/read override paths.
- `fs/tree.ts` (~150 lines) — read a directory into a tree model
  `TreeNode = { path, name, kind: 'file' | 'dir', children? }`; CRUD:
  `createFile`, `createDir`, `rename`, `remove`, `move`. Thin wrapper over
  plugin-fs; the model transforms (entries→tree, move→path rewrite) are pure
  and unit-tested.
- `fs/save.ts` — debounced write-to-disk (mirrors `store.ts` debounce pattern).
- `components/Explorer.tsx` (~200 lines) — tree UI: expand/collapse, context
  menu (new/rename/delete), drag-drop move, click opens a tab, toolbar
  (new file, new folder, refresh).
- `components/TreeNode.tsx` (~100 lines) — one node row: icon, indentation,
  inline-rename input.

## Tab model change (file-backed)

```
Tab = {
  id, path, title (basename), content,
  // tool-specific result state, kept in memory only:
  result | outcome, error, view | traceOpen
}
```

- Content is loaded from the file on open; edits debounce-write back to the file.
- Persist only open file paths + active path per tool:
  `tabs.soql` → `{ openPaths: string[], activePath: string | null }`
  (same for `tabs.apex`). Content lives in the file, not the store.
- Opening an already-open file just activates its tab. Closing a tab never
  deletes the file. Reuse `tabs/useTabs.ts` — swap the tab type and add
  load-on-open / autosave-on-change.

## Layout

- Rail unchanged (`SOQL / Apex / Logs`).
- SOQL/Apex panel: `[ Explorer (fixed ~240px) | TabStrip + Editor + Results ]`.
- Logs panel unchanged.

## File operations

- **New file / folder:** toolbar + context menu, inline name input.
- **Rename:** F2 / context menu → `fs.rename` → rewrite path on any open tab.
- **Delete:** context menu → confirm → `fs.remove` → close any open tab for it.
- **Move:** drag node onto a folder → `fs.rename` (move) → update open-tab paths.

## Autosave / results / history

- Content change debounces (~400ms) to disk. Run uses current editor content.
- Result/outcome stay in memory per tab; only the script text is the file.
- Run history (`history.ts`) is unchanged.

## Migration (one-time)

On first launch after upgrade: if the workspace is empty and old
`tabs.soql`/`tabs.apex` exist in the store, write each persisted tab's
`query`/`src` into `<title>.soql` / `<title>.apex` at the workspace root, open
them, then set a `migrated.explorer` flag so it runs once.

## Deferred (YAGNI)

- Live FS watcher for external edits — instead: manual refresh button +
  refresh on window focus. Add a watcher only if it proves necessary.
- Split / side-by-side editors — not requested.
- Resizable sidebar — fixed width first.

## Testing

- Pure-function tests for `tree.ts` transforms (entries→tree, move→path
  rewrite) and `workspace.ts` path resolution.
- CRUD against a temp dir; migration logic.
