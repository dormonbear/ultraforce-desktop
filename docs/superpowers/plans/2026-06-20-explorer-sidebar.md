# Explorer Sidebar + File-Backed Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tab-strip-only management of SOQL/Apex scripts with a VSCode-style file-explorer sidebar backed by real files on disk, two separate trees, file-backed tabs.

**Architecture:** Each tool (SOQL, Apex) renders `[ Explorer sidebar | TabStrip + existing View ]`. Scripts are real `*.soql`/`*.apex` files under a workspace root (default `appDataDir/workspace/{soql,apex}`, overridable). Tabs reference a file `path`; content is loaded from disk into the existing `query`/`src` field and debounce-autosaved back, so `SoqlView`/`ApexView` stay untouched. The store persists only open paths + active path per tool.

**Tech Stack:** React 19, Tauri 2 (`tauri-plugin-fs`, `tauri-plugin-dialog`, existing `tauri-plugin-store`), Vitest (node env — pure-function tests only).

## Global Constraints

- English for code/comments; no author attribution.
- Vitest runs in **node env** (no jsdom). Only pure functions get unit tests; UI + fs integration is verified by `npm run build` (tsc) + manual app run.
- fs/dialog access goes through Tauri JS plugins; capability scope limited to the workspace roots.
- Keep the existing `SoqlView`/`ApexView` props (`tab.query`/`tab.src`, `onPatch`) unchanged — content field stays the live editor value.
- Autosave debounce ~400ms (mirror `store.ts`).
- Files small & focused: new modules under `src/fs/` (logic) and `src/components/` (UI).

---

### Task 1: Add Tauri fs + dialog plugins and capabilities

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml` (add deps)
- Modify: `desktop/src-tauri/src/lib.rs` (register plugins)
- Modify: `desktop/src-tauri/capabilities/default.json` (permissions)
- Modify: `desktop/package.json` (JS deps)

**Interfaces:**
- Produces: JS modules `@tauri-apps/plugin-fs` (`mkdir`, `readDir`, `readTextFile`, `writeTextFile`, `rename`, `remove`, `exists`, `BaseDirectory`) and `@tauri-apps/plugin-dialog` (`open`) usable from the frontend.

- [ ] **Step 1: Add Rust deps**

In `desktop/src-tauri/Cargo.toml`, under `[dependencies]` next to `tauri-plugin-store = "2"`:

```toml
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register plugins in lib.rs**

Find the builder chain `.plugin(tauri_plugin_store::Builder::default().build())` and add after it:

```rust
.plugin(tauri_plugin_fs::init())
.plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Grant capabilities**

In `desktop/src-tauri/capabilities/default.json`, replace the `permissions` array with:

```json
"permissions": [
  "core:default",
  "store:default",
  "dialog:default",
  "fs:allow-mkdir",
  "fs:allow-read-dir",
  "fs:allow-read-text-file",
  "fs:allow-write-text-file",
  "fs:allow-rename",
  "fs:allow-remove",
  "fs:allow-exists",
  {
    "identifier": "fs:scope",
    "allow": [{ "path": "$APPDATA/workspace/**" }]
  }
]
```

User-chosen roots outside `$APPDATA` are reached by passing absolute paths; the dialog-selected path is granted at runtime via the fs plugin's returned scope (acceptable for a desktop tool — note the limitation in code).

- [ ] **Step 4: Add JS deps**

```bash
cd desktop && npm install @tauri-apps/plugin-fs @tauri-apps/plugin-dialog
```

- [ ] **Step 5: Verify build**

Run: `cd desktop && npm run tauri build -- --debug` is heavy; instead verify Rust compiles:
`cd desktop/src-tauri && cargo check`
Expected: compiles with the two new plugins.

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock desktop/src-tauri/src/lib.rs desktop/src-tauri/capabilities/default.json desktop/package.json desktop/package-lock.json
git commit -m "feat(desktop): add tauri fs + dialog plugins for script files"
```

---

### Task 2: Pure path helpers + tree model (`fs/paths.ts`, `fs/tree.ts`)

**Files:**
- Create: `desktop/src/fs/paths.ts`
- Create: `desktop/src/fs/paths.test.ts`
- Create: `desktop/src/fs/tree.ts`
- Create: `desktop/src/fs/tree.test.ts`

**Interfaces:**
- Produces (`paths.ts`):
  - `joinPath(...parts: string[]): string`
  - `basename(path: string): string`
  - `dirname(path: string): string`
  - `movedPath(itemPath: string, intoDir: string): string` — new path when `itemPath` moves into `intoDir`
- Produces (`tree.ts`):
  - `type TreeNode = { path: string; name: string; kind: "file" | "dir"; children?: TreeNode[] }`
  - `readTree(root: string): Promise<TreeNode[]>` — recursive `readDir`, dirs first then files, name-sorted
  - `createFile(dir: string, name: string): Promise<string>` (returns new path)
  - `createDir(dir: string, name: string): Promise<string>`
  - `renameNode(path: string, newName: string): Promise<string>` (returns new path)
  - `removeNode(path: string, isDir: boolean): Promise<void>`
  - `moveNode(path: string, intoDir: string): Promise<string>` (returns new path)

- [ ] **Step 1: Write failing tests for `paths.ts`**

Create `desktop/src/fs/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { joinPath, basename, dirname, movedPath } from "./paths";

describe("paths", () => {
  it("joins parts with a single slash", () => {
    expect(joinPath("/a", "b", "c.soql")).toBe("/a/b/c.soql");
    expect(joinPath("/a/", "/b/")).toBe("/a/b");
  });
  it("basename returns the last segment", () => {
    expect(basename("/a/b/c.soql")).toBe("c.soql");
    expect(basename("c.soql")).toBe("c.soql");
  });
  it("dirname returns the parent", () => {
    expect(dirname("/a/b/c.soql")).toBe("/a/b");
    expect(dirname("/a")).toBe("");
  });
  it("movedPath re-parents an item into a dir", () => {
    expect(movedPath("/a/b/c.soql", "/a/x")).toBe("/a/x/c.soql");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/paths.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `paths.ts`**

```ts
/** POSIX-style path helpers (Tauri paths use forward slashes on all targets). */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")
    .replace(/^/, "/");
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function movedPath(itemPath: string, intoDir: string): string {
  return joinPath(intoDir, basename(itemPath));
}
```

Note: `joinPath("/a/", "/b/")` → leading slash added once; the `.replace(/^/, "/")` prefixes the joined body. Verify the first test's `"/a/b"` expectation holds; if the absolute-prefix handling needs the first part's leading slash preserved differently, adjust the `joinPath` body and the test together so both agree.

- [ ] **Step 4: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for tree sort/shape**

`tree.ts` wraps plugin-fs, so test only the pure `sortEntries` helper it exports. Create `desktop/src/fs/tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortEntries } from "./tree";

describe("sortEntries", () => {
  it("dirs first, then files, each name-sorted", () => {
    const out = sortEntries([
      { name: "b.soql", isDirectory: false },
      { name: "Zfolder", isDirectory: true },
      { name: "a.soql", isDirectory: false },
      { name: "Afolder", isDirectory: true },
    ]);
    expect(out.map((e) => e.name)).toEqual(["Afolder", "Zfolder", "a.soql", "b.soql"]);
  });
});
```

- [ ] **Step 6: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/tree.test.ts`
Expected: FAIL (no `sortEntries`).

- [ ] **Step 7: Implement `tree.ts`**

```ts
import {
  mkdir,
  readDir,
  rename,
  remove,
  type DirEntry,
} from "@tauri-apps/plugin-fs";
import { joinPath, basename, dirname, movedPath } from "./paths";

export type TreeNode = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: TreeNode[];
};

type Entry = { name: string; isDirectory: boolean };

/** Dirs before files; each group sorted case-insensitively by name. */
export function sortEntries<T extends Entry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

async function readInto(dir: string): Promise<TreeNode[]> {
  const entries = (await readDir(dir)) as DirEntry[];
  const nodes: TreeNode[] = [];
  for (const e of sortEntries(entries)) {
    const path = joinPath(dir, e.name);
    nodes.push(
      e.isDirectory
        ? { path, name: e.name, kind: "dir", children: await readInto(path) }
        : { path, name: e.name, kind: "file" },
    );
  }
  return nodes;
}

export function readTree(root: string): Promise<TreeNode[]> {
  return readInto(root);
}

export async function createFile(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name);
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, "");
  return path;
}

export async function createDir(dir: string, name: string): Promise<string> {
  const path = joinPath(dir, name);
  await mkdir(path, { recursive: true });
  return path;
}

export async function renameNode(path: string, newName: string): Promise<string> {
  const next = joinPath(dirname(path), newName);
  await rename(path, next);
  return next;
}

export async function removeNode(path: string, isDir: boolean): Promise<void> {
  await remove(path, { recursive: isDir });
}

export async function moveNode(path: string, intoDir: string): Promise<string> {
  const next = movedPath(path, intoDir);
  await rename(path, next);
  return next;
}
```

- [ ] **Step 8: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/paths.test.ts src/fs/tree.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/fs/paths.ts desktop/src/fs/paths.test.ts desktop/src/fs/tree.ts desktop/src/fs/tree.test.ts
git commit -m "feat(desktop): pure path helpers + fs tree model"
```

---

### Task 3: Workspace root resolution (`fs/workspace.ts`)

**Files:**
- Create: `desktop/src/fs/workspace.ts`
- Create: `desktop/src/fs/workspace.test.ts`

**Interfaces:**
- Consumes: `getJson`/`setJson` from `../store`; `appDataDir` from `@tauri-apps/api/path`; `mkdir`, `exists` from `@tauri-apps/plugin-fs`; `joinPath` from `./paths`.
- Produces:
  - `type Tool = "soql" | "apex"`
  - `resolveRoot(tool: Tool, override: string | null, appData: string): string` — pure
  - `getRoot(tool: Tool): Promise<string>` — reads override from store, joins default, ensures dir exists, returns absolute root
  - `setRootOverride(tool: Tool, path: string | null): Promise<void>`

- [ ] **Step 1: Write failing test for `resolveRoot`**

Create `desktop/src/fs/workspace.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveRoot } from "./workspace";

describe("resolveRoot", () => {
  it("uses the override when set", () => {
    expect(resolveRoot("soql", "/custom/soql", "/app")).toBe("/custom/soql");
  });
  it("falls back to appData/workspace/<tool>", () => {
    expect(resolveRoot("apex", null, "/app")).toBe("/app/workspace/apex");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/workspace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `workspace.ts`**

```ts
import { appDataDir } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { joinPath } from "./paths";

export type Tool = "soql" | "apex";

const overrideKey = (tool: Tool) => `workspace.${tool}.path`;

/** Pure: override wins, else <appData>/workspace/<tool>. */
export function resolveRoot(tool: Tool, override: string | null, appData: string): string {
  return override ?? joinPath(appData, "workspace", tool);
}

export async function getRoot(tool: Tool): Promise<string> {
  const override = await getJson<string | null>(overrideKey(tool), null);
  const root = resolveRoot(tool, override, await appDataDir());
  if (!(await exists(root))) await mkdir(root, { recursive: true });
  return root;
}

export async function setRootOverride(tool: Tool, path: string | null): Promise<void> {
  await setJson(overrideKey(tool), path);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/fs/workspace.ts desktop/src/fs/workspace.test.ts
git commit -m "feat(desktop): workspace root resolution + ensure-dir"
```

---

### Task 4: Debounced file saver (`fs/save.ts`)

**Files:**
- Create: `desktop/src/fs/save.ts`
- Create: `desktop/src/fs/save.test.ts`

**Interfaces:**
- Produces:
  - `saveFile(path: string, content: string): void` — debounced per path (~400ms)
  - `flushFiles(): Promise<void>` — write all pending immediately
  - For tests: accepts an injectable writer via `__setWriter(fn)` (default = plugin-fs `writeTextFile`).

- [ ] **Step 1: Write failing test (fake timers)**

Create `desktop/src/fs/save.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveFile, flushFiles, __setWriter } from "./save";

describe("saveFile", () => {
  beforeEach(() => vi.useFakeTimers());

  it("coalesces rapid writes per path", async () => {
    const writes: [string, string][] = [];
    __setWriter(async (p, c) => { writes.push([p, c]); });
    saveFile("/a.soql", "v1");
    saveFile("/a.soql", "v2");
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toEqual([["/a.soql", "v2"]]);
  });

  it("flushFiles writes pending immediately", async () => {
    const writes: [string, string][] = [];
    __setWriter(async (p, c) => { writes.push([p, c]); });
    saveFile("/b.soql", "x");
    await flushFiles();
    expect(writes).toEqual([["/b.soql", "x"]]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/save.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `save.ts`**

```ts
import { writeTextFile } from "@tauri-apps/plugin-fs";

const DEBOUNCE_MS = 400;
type Writer = (path: string, content: string) => Promise<void>;

let writer: Writer = (p, c) => writeTextFile(p, c);
/** Test seam. */
export function __setWriter(fn: Writer): void {
  writer = fn;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, string>();

export function saveFile(path: string, content: string): void {
  pending.set(path, content);
  const prev = timers.get(path);
  if (prev) clearTimeout(prev);
  timers.set(
    path,
    setTimeout(() => {
      const c = pending.get(path);
      timers.delete(path);
      pending.delete(path);
      if (c != null) void writer(path, c);
    }, DEBOUNCE_MS),
  );
}

export async function flushFiles(): Promise<void> {
  const entries = [...pending.entries()];
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  pending.clear();
  await Promise.all(entries.map(([p, c]) => writer(p, c)));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/save.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/fs/save.ts desktop/src/fs/save.test.ts
git commit -m "feat(desktop): debounced per-file saver"
```

---

### Task 5: File-backed tabs hook (`tabs/useFileTabs.ts`)

**Files:**
- Create: `desktop/src/tabs/useFileTabs.ts`
- Modify: `desktop/src/tabs/types.ts` (add `path` to `SoqlTab`/`ApexTab`)

**Interfaces:**
- Consumes: `readTextFile` from `@tauri-apps/plugin-fs`; `saveFile` from `../fs/save`; `getJson`/`setJson`; `basename` from `../fs/paths`.
- Produces:
  - `type FileTab = TabBase & { path: string }` (SoqlTab/ApexTab already extend TabBase; add `path: string`)
  - `useFileTabs<T extends TabBase & { path: string }>(opts): { tabs, active, activeId, openFile, close, select, patch }`
    - `opts = { tool: "soql" | "apex"; contentKey: keyof T; make: (path: string, content: string) => T }`
  - Hydrates open paths from `tabs.<tool>` (`{ openPaths, activePath }`), reads each file's content into the tab via `make`, autosaves `contentKey` on patch, persists open paths on change.

- [ ] **Step 1: Add `path` to tab types**

In `desktop/src/tabs/types.ts`, add `path: string;` to both `SoqlTab` and `ApexTab` (first field after `extends TabBase`).

- [ ] **Step 2: Implement `useFileTabs.ts`**

(No node-env unit test — depends on React + plugin-fs; verified via build + manual run. Keep logic minimal.)

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { saveFile } from "../fs/save";
import { basename } from "../fs/paths";
import type { TabBase } from "./types";

interface Persisted {
  openPaths: string[];
  activePath: string | null;
}

interface Opts<T> {
  tool: "soql" | "apex";
  contentKey: keyof T;
  make: (path: string, content: string) => T;
}

export function useFileTabs<T extends TabBase & { path: string }>(opts: Opts<T>) {
  const { tool, contentKey, make } = opts;
  const [tabs, setTabs] = useState<T[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const hydrated = useRef(false);
  const storeKey = `tabs.${tool}`;

  // Hydrate: read persisted open paths, load each file's content.
  useEffect(() => {
    let cancelled = false;
    void getJson<Persisted | null>(storeKey, null).then(async (saved) => {
      if (cancelled || !saved) {
        hydrated.current = true;
        return;
      }
      const loaded: T[] = [];
      for (const path of saved.openPaths) {
        try {
          loaded.push(make(path, await readTextFile(path)));
        } catch {
          /* file deleted out-of-band — skip */
        }
      }
      if (cancelled) return;
      setTabs(loaded);
      const act = loaded.find((t) => t.path === saved.activePath) ?? loaded[0];
      setActiveId(act?.id ?? null);
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [storeKey, make]);

  // Persist open paths + active path (never content).
  useEffect(() => {
    if (!hydrated.current) return;
    const active = tabs.find((t) => t.id === activeId) ?? null;
    void setJson<Persisted>(storeKey, {
      openPaths: tabs.map((t) => t.path),
      activePath: active?.path ?? null,
    });
  }, [tabs, activeId, storeKey]);

  const openFile = useCallback(
    async (path: string) => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const tab = make(path, await readTextFile(path));
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    },
    [tabs, make],
  );

  const close = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) =>
        cur !== id ? cur : (next[idx - 1] ?? next[idx] ?? next[0])?.id ?? null,
      );
      return next;
    });
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const patch = useCallback(
    (id: string, partial: Partial<T>) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...partial };
          // Autosave only when the content field changed.
          if (contentKey in partial) {
            saveFile(updated.path, String(updated[contentKey]));
          }
          return updated;
        }),
      );
    },
    [contentKey],
  );

  // Reflect external path changes (rename/move) on any open tab.
  const retitle = useCallback((from: string, to: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === from ? { ...t, path: to, title: basename(to) } : t,
      ),
    );
  }, []);

  // Close a tab whose file was deleted.
  const closeByPath = useCallback((path: string) => {
    setTabs((prev) => {
      const t = prev.find((x) => x.path === path);
      if (!t) return prev;
      const idx = prev.findIndex((x) => x.id === t.id);
      const next = prev.filter((x) => x.id !== t.id);
      setActiveId((cur) =>
        cur !== t.id ? cur : (next[idx - 1] ?? next[idx] ?? next[0])?.id ?? null,
      );
      return next;
    });
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  return { tabs, active, activeId, openFile, close, select, patch, retitle, closeByPath };
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd desktop && npx tsc --noEmit`
Expected: no errors from `useFileTabs.ts` / `types.ts`.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/tabs/useFileTabs.ts desktop/src/tabs/types.ts
git commit -m "feat(desktop): file-backed tabs hook"
```

---

### Task 6: Explorer + TreeNode UI

**Files:**
- Create: `desktop/src/components/TreeNode.tsx`
- Create: `desktop/src/components/Explorer.tsx`

**Interfaces:**
- Consumes: `TreeNode` type + CRUD from `../fs/tree`; `basename` from `../fs/paths`.
- Produces:
  - `<Explorer root={string} ext="soql"|"apex" activePath={string|null} onOpen={(path)=>void} onRenamed={(from,to)=>void} onRemoved={(path)=>void} />`
    - Loads its tree via `readTree(root)`; toolbar: new file, new folder, refresh; context menu (right-click) for new/rename/delete; drag node onto a dir → `moveNode` then `onRenamed`.
  - `<TreeNode node depth activePath onOpen onContextMenu editing onCommitName onDragStartNode onDropOnDir />` — one row.

- [ ] **Step 1: Implement `TreeNode.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, FileCode, Folder } from "lucide-react";
import type { TreeNode as Node } from "../fs/tree";

interface Props {
  node: Node;
  depth: number;
  expanded: boolean;
  active: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCommitName: (name: string) => void;
  onCancelEdit: () => void;
  onDragStartNode: () => void;
  onDropOnDir: () => void;
}

/** One tree row: indent by depth, icon, label or inline-rename input. */
export function TreeNode(p: Props) {
  const { node, depth, expanded, active, editing } = p;
  const inputRef = useRef<HTMLInputElement>(null);
  const isDir = node.kind === "dir";
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div
      role="treeitem"
      aria-selected={active}
      draggable={!editing}
      onDragStart={(e) => {
        e.stopPropagation();
        p.onDragStartNode();
      }}
      onDragOver={isDir ? (e) => e.preventDefault() : undefined}
      onDrop={
        isDir
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              p.onDropOnDir();
            }
          : undefined
      }
      onClick={() => (isDir ? p.onToggle() : p.onOpen())}
      onContextMenu={p.onContextMenu}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`flex h-6 cursor-pointer items-center gap-1 rounded-[3px] pr-2 text-[12px] ${
        active ? "bg-primary/15 text-primary" : "text-text-dim hover:text-foreground hover:bg-card"
      }`}
    >
      {isDir ? (
        expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
      ) : (
        <span className="w-3" />
      )}
      {isDir ? <Folder size={13} /> : <FileCode size={13} />}
      {editing ? (
        <input
          ref={inputRef}
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => p.onCommitName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") p.onCommitName(e.currentTarget.value);
            else if (e.key === "Escape") p.onCancelEdit();
          }}
          className="w-full rounded-[2px] bg-transparent text-[12px] text-foreground outline-none ring-1 ring-primary/60"
        />
      ) : (
        <span className="truncate">{node.name}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `Explorer.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import {
  readTree,
  createFile,
  createDir,
  renameNode,
  removeNode,
  moveNode,
  type TreeNode as Node,
} from "../fs/tree";
import { dirname } from "../fs/paths";
import { TreeNode } from "./TreeNode";

interface Props {
  root: string;
  ext: "soql" | "apex";
  activePath: string | null;
  onOpen: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (path: string) => void;
}

type Edit = { path: string; kind: "rename" } | { dir: string; kind: "new-file" | "new-dir" };

/** File-explorer sidebar for one tool's workspace root. */
export function Explorer({ root, ext, activePath, onOpen, onRenamed, onRemoved }: Props) {
  const [tree, setTree] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  const [drag, setDrag] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void readTree(root).then(setTree);
  }, [root]);
  useEffect(refresh, [refresh]);
  // Re-read when the window regains focus (cheap external-change pickup).
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const commitName = async (name: string) => {
    const e = edit;
    setEdit(null);
    const trimmed = name.trim();
    if (!e || !trimmed) return;
    if (e.kind === "rename") {
      const to = await renameNode(e.path, trimmed);
      onRenamed(e.path, to);
    } else {
      const fullName = e.kind === "new-file" ? ensureExt(trimmed, ext) : trimmed;
      if (e.kind === "new-file") await createFile(e.dir, fullName);
      else await createDir(e.dir, fullName);
    }
    refresh();
  };

  const del = async (node: Node) => {
    await removeNode(node.path, node.kind === "dir");
    onRemoved(node.path);
    refresh();
  };

  const onContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    // Minimal menu via native confirm/prompt-free inline edit:
    // right-click a file/dir → start rename; Shift+right-click → delete.
    if (e.shiftKey) void del(node);
    else setEdit({ path: node.path, kind: "rename" });
  };

  const newAt = (kind: "new-file" | "new-dir") => {
    const dir = activePath ? dirname(activePath) : root;
    setEdit({ dir, kind });
  };

  const drop = async (intoDir: string) => {
    if (!drag) return;
    const from = drag;
    setDrag(null);
    const to = await moveNode(from, intoDir);
    onRenamed(from, to);
    refresh();
  };

  const rows: JSX.Element[] = [];
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      const isOpen = expanded.has(n.path);
      rows.push(
        <TreeNode
          key={n.path}
          node={n}
          depth={depth}
          expanded={isOpen}
          active={n.path === activePath}
          editing={edit?.kind === "rename" && edit.path === n.path}
          onToggle={() => toggle(n.path)}
          onOpen={() => onOpen(n.path)}
          onContextMenu={(e) => onContextMenu(e, n)}
          onCommitName={commitName}
          onCancelEdit={() => setEdit(null)}
          onDragStartNode={() => setDrag(n.path)}
          onDropOnDir={() => void drop(n.path)}
        />,
      );
      if (n.kind === "dir" && isOpen && n.children) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);

  return (
    <div
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-background"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void drop(root);
      }}
    >
      <div className="flex h-9 items-center justify-end gap-1 border-b border-border px-2">
        <IconBtn label="New file" onClick={() => newAt("new-file")}>
          <FilePlus size={14} />
        </IconBtn>
        <IconBtn label="New folder" onClick={() => newAt("new-dir")}>
          <FolderPlus size={14} />
        </IconBtn>
        <IconBtn label="Refresh" onClick={refresh}>
          <RefreshCw size={13} />
        </IconBtn>
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-auto py-1">
        {rows}
        {edit && edit.kind !== "rename" && (
          <NewRow ext={ext} kind={edit.kind} onCommit={commitName} onCancel={() => setEdit(null)} />
        )}
      </div>
    </div>
  );
}

function ensureExt(name: string, ext: string): string {
  return name.endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:text-primary"
    >
      {children}
    </button>
  );
}

function NewRow({
  ext,
  kind,
  onCommit,
  onCancel,
}: {
  ext: string;
  kind: "new-file" | "new-dir";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      placeholder={kind === "new-file" ? `name.${ext}` : "folder name"
      }
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(e.currentTarget.value);
        else if (e.key === "Escape") onCancel();
      }}
      className="mx-2 my-1 w-[210px] rounded-[2px] bg-card px-1 text-[12px] text-foreground outline-none ring-1 ring-primary/60"
    />
  );
}
```

Note: context menu is intentionally minimal (right-click = rename, Shift+right-click = delete) to avoid a popover dependency. If a real menu is wanted later, swap in radix-ui `ContextMenu` (already a dep).

- [ ] **Step 3: Verify type-check**

Run: `cd desktop && npx tsc --noEmit`
Expected: no errors. (Add `import type { JSX } from "react";` if `JSX` is unresolved under React 19.)

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/TreeNode.tsx desktop/src/components/Explorer.tsx
git commit -m "feat(desktop): explorer sidebar + tree node UI"
```

---

### Task 7: Wire SOQL/Apex panels to Explorer + file tabs

**Files:**
- Rewrite: `desktop/src/panels/SoqlTabs.tsx`
- Rewrite: `desktop/src/panels/ApexTabs.tsx`

**Interfaces:**
- Consumes: `useFileTabs`, `Explorer`, `getRoot` from `../fs/workspace`, existing `SoqlView`/`ApexView`, `TabStrip`.
- Produces: each panel renders `[ Explorer | TabStrip + View ]`, all tab content file-backed.

- [ ] **Step 1: Rewrite `SoqlTabs.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useFileTabs } from "../tabs/useFileTabs";
import { Explorer } from "../components/Explorer";
import { getRoot } from "../fs/workspace";
import { basename } from "../fs/paths";
import { SoqlView } from "./SoqlPanel";
import type { SoqlTab } from "../tabs/types";

const makeSoqlTab = (path: string, content: string): SoqlTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  query: content,
  result: null,
  error: null,
  view: "table",
});

export function SoqlTabs() {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    void getRoot("soql").then(setRoot);
  }, []);

  const make = useMemo(() => makeSoqlTab, []);
  const { tabs, active, activeId, openFile, close, select, patch, retitle, closeByPath } =
    useFileTabs<SoqlTab>({ tool: "soql", contentKey: "query", make });

  const onPatch = useCallback(
    (partial: Partial<SoqlTab>) => activeId && patch(activeId, partial),
    [patch, activeId],
  );

  return (
    <div className="flex h-full">
      {root && (
        <Explorer
          root={root}
          ext="soql"
          activePath={active?.path ?? null}
          onOpen={(p) => void openFile(p)}
          onRenamed={retitle}
          onRemoved={closeByPath}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <TabStrip
              tabs={tabs}
              activeId={activeId ?? ""}
              ariaLabel="SOQL tabs"
              onSelect={select}
              onClose={close}
              onAdd={() => {}}
            />
            <div role="tabpanel" className="min-h-0 flex-1">
              <SoqlView key={active.id} tab={active} onPatch={onPatch} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            — open a query from the sidebar —
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: TabStrip's `onAdd` (the `+`) is a no-op now — new scripts come from the Explorer. Leaving it inert is fine; a follow-up can hide the button when desired.

- [ ] **Step 2: Rewrite `ApexTabs.tsx`** (mirror of SOQL)

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { TabStrip } from "../tabs/TabStrip";
import { useFileTabs } from "../tabs/useFileTabs";
import { Explorer } from "../components/Explorer";
import { getRoot } from "../fs/workspace";
import { basename } from "../fs/paths";
import { ApexView } from "./ApexPanel";
import type { ApexTab } from "../tabs/types";

const makeApexTab = (path: string, content: string): ApexTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  src: content,
  outcome: null,
  error: null,
  traceOpen: false,
});

export function ApexTabs() {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    void getRoot("apex").then(setRoot);
  }, []);

  const make = useMemo(() => makeApexTab, []);
  const { tabs, active, activeId, openFile, close, select, patch, retitle, closeByPath } =
    useFileTabs<ApexTab>({ tool: "apex", contentKey: "src", make });

  const onPatch = useCallback(
    (partial: Partial<ApexTab>) => activeId && patch(activeId, partial),
    [patch, activeId],
  );

  return (
    <div className="flex h-full">
      {root && (
        <Explorer
          root={root}
          ext="apex"
          activePath={active?.path ?? null}
          onOpen={(p) => void openFile(p)}
          onRenamed={retitle}
          onRemoved={closeByPath}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <TabStrip
              tabs={tabs}
              activeId={activeId ?? ""}
              ariaLabel="Apex tabs"
              onSelect={select}
              onClose={close}
              onAdd={() => {}}
            />
            <div role="tabpanel" className="min-h-0 flex-1">
              <ApexView key={active.id} tab={active} onPatch={onPatch} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            — open a script from the sidebar —
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Drop history "open in tab" wiring that relied on `openWith`**

`SoqlTabs`/`ApexTabs` no longer import `consumePending`/`onOpenTabRequest`. The History drawer's "open in tab" now has no target. Decision: keep it lazy — leave History as a read-only viewer for this iteration (the open-in-tab affordance becomes a copy action in a later task). Verify no remaining imports reference removed symbols: `cd desktop && npx tsc --noEmit`.

- [ ] **Step 4: Build**

Run: `cd desktop && npm run build`
Expected: tsc + vite build succeed.

- [ ] **Step 5: Manual smoke (app run)**

Run: `cd desktop && npm run tauri dev`
Verify: SOQL/Apex panels show a sidebar; New file creates `*.soql`/`*.apex`; clicking opens a tab; editing autosaves (reopen shows persisted text); rename/delete/drag-move work; restart restores open tabs.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/panels/SoqlTabs.tsx desktop/src/panels/ApexTabs.tsx
git commit -m "feat(desktop): wire explorer + file-backed tabs into SOQL/Apex panels"
```

---

### Task 8: One-time migration of old persisted tabs to files

**Files:**
- Create: `desktop/src/fs/migrate.ts`
- Create: `desktop/src/fs/migrate.test.ts`
- Modify: `desktop/src/main.tsx` (run migration before render)

**Interfaces:**
- Consumes: old store shape `{ tabs: {title, query|src}[], activeId }` under `tabs.soql`/`tabs.apex`.
- Produces:
  - `planMigration(tool, oldTabs): { name: string; content: string }[]` — pure; sanitizes title → filename, dedupes, adds extension
  - `runMigrationOnce(): Promise<void>` — guarded by `migrated.explorer` flag; writes files into each tool root, then rewrites `tabs.<tool>` to the new `{ openPaths, activePath }` shape

- [ ] **Step 1: Write failing test for `planMigration`**

```ts
import { describe, it, expect } from "vitest";
import { planMigration } from "./migrate";

describe("planMigration", () => {
  it("maps titles to unique <name>.<ext> files", () => {
    const out = planMigration("soql", [
      { title: "My Query", query: "SELECT Id FROM Account" },
      { title: "My Query", query: "SELECT Name FROM Lead" },
    ]);
    expect(out).toEqual([
      { name: "My Query.soql", content: "SELECT Id FROM Account" },
      { name: "My Query (2).soql", content: "SELECT Name FROM Lead" },
    ]);
  });
  it("uses src for apex", () => {
    const out = planMigration("apex", [{ title: "x", src: "System.debug(1);" }]);
    expect(out).toEqual([{ name: "x.apex", content: "System.debug(1);" }]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/migrate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `migrate.ts`**

```ts
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getJson, setJson } from "../store";
import { getRoot, type Tool } from "./workspace";
import { joinPath } from "./paths";

type OldTab = { title: string; query?: string; src?: string };

const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|]/g, "_").trim() || "untitled";

/** Pure: old tabs → unique filenames with content. */
export function planMigration(tool: Tool, oldTabs: OldTab[]): { name: string; content: string }[] {
  const ext = tool;
  const seen = new Map<string, number>();
  return oldTabs.map((t) => {
    const base = sanitize(t.title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const name = `${base}${n > 1 ? ` (${n})` : ""}.${ext}`;
    return { name, content: tool === "soql" ? (t.query ?? "") : (t.src ?? "") };
  });
}

async function migrateTool(tool: Tool): Promise<void> {
  const old = await getJson<{ tabs: OldTab[]; activeId?: string } | null>(`tabs.${tool}`, null);
  if (!old || !Array.isArray(old.tabs) || old.tabs.length === 0) return;
  // Already migrated to the new shape? (has openPaths) — skip.
  if ("openPaths" in (old as object)) return;
  const root = await getRoot(tool);
  const plan = planMigration(tool, old.tabs);
  const openPaths: string[] = [];
  for (const { name, content } of plan) {
    const path = joinPath(root, name);
    await writeTextFile(path, content);
    openPaths.push(path);
  }
  await setJson(`tabs.${tool}`, { openPaths, activePath: openPaths[0] ?? null });
}

export async function runMigrationOnce(): Promise<void> {
  if (await getJson<boolean>("migrated.explorer", false)) return;
  try {
    await migrateTool("soql");
    await migrateTool("apex");
    await setJson("migrated.explorer", true);
  } catch {
    /* leave the flag unset so it retries next launch */
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Run migration on startup**

In `desktop/src/main.tsx`, before `ReactDOM.createRoot(...)`, add:

```tsx
import { runMigrationOnce } from "./fs/migrate";

await runMigrationOnce();
```

If top-level await is unavailable in this entry, wrap render in `.then`:

```tsx
void runMigrationOnce().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    /* existing tree */
  );
});
```

- [ ] **Step 6: Build + commit**

Run: `cd desktop && npm run build` (Expected: success)

```bash
git add desktop/src/fs/migrate.ts desktop/src/fs/migrate.test.ts desktop/src/main.tsx
git commit -m "feat(desktop): one-time migrate persisted tabs to script files"
```

---

### Task 9: Settings — change workspace root

**Files:**
- Create: `desktop/src/components/WorkspaceSettings.tsx`
- Modify: `desktop/src/App.tsx` (mount a settings entry in the header)

**Interfaces:**
- Consumes: `open` from `@tauri-apps/plugin-dialog`; `setRootOverride`, `getRoot` from `../fs/workspace`.
- Produces: a small popover/dialog with, per tool, the current root + a "Change…" button (folder picker) and "Reset to default". On change, persists override and triggers a reload of the affected panel (simplest: prompt the user that a reload applies — or force-remount via a key bump).

- [ ] **Step 1: Implement `WorkspaceSettings.tsx`**

```tsx
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";

interface Props {
  onChanged: () => void;
}

/** Per-tool workspace root: show current path, pick a new folder, or reset. */
export function WorkspaceSettings({ onChanged }: Props) {
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });

  const reload = () =>
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
  useEffect(reload, []);

  const pick = async (tool: Tool) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await setRootOverride(tool, dir);
    reload();
    onChanged();
  };

  const reset = async (tool: Tool) => {
    await setRootOverride(tool, null);
    reload();
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3 p-1 text-[12px]">
      {(["soql", "apex"] as Tool[]).map((tool) => (
        <div key={tool} className="flex flex-col gap-1">
          <span className="uppercase tracking-wide text-text-dim">{tool} workspace</span>
          <span className="truncate text-foreground" title={roots[tool]}>
            {roots[tool]}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void pick(tool)}
              className="rounded-md bg-primary/15 px-2 py-0.5 text-primary hover:bg-primary/25"
            >
              Change…
            </button>
            <button
              type="button"
              onClick={() => void reset(tool)}
              className="rounded-md px-2 py-0.5 text-text-dim hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount in `App.tsx` header**

Add a `Settings` (lucide `Settings` icon) button next to History that toggles a popover containing `<WorkspaceSettings onChanged={...} />`. On `onChanged`, bump a `workspaceVersion` state passed as `key` to the `<main>` content so the active panel remounts and re-reads its root:

```tsx
// state
const [wsVersion, setWsVersion] = useState(0);
// in <main>, key the tool panels:
{active === "soql" && <SoqlTabs key={`soql-${wsVersion}`} />}
{active === "apex" && <ApexTabs key={`apex-${wsVersion}`} />}
// settings popover button calls: onChanged={() => setWsVersion((v) => v + 1)}
```

Use the existing radix `Popover` (radix-ui is a dep) or a simple absolutely-positioned panel mirroring `HistoryDrawer`. Keep it minimal.

- [ ] **Step 3: Build**

Run: `cd desktop && npm run build`
Expected: success.

- [ ] **Step 4: Manual smoke**

Run app, open Settings, change SOQL root to a folder, confirm the SOQL tree re-roots; Reset returns to default.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/WorkspaceSettings.tsx desktop/src/App.tsx
git commit -m "feat(desktop): settings to change/reset workspace roots"
```

---

## Self-Review

**Spec coverage:**
- Real disk files → Tasks 1–2. Two trees + rail kept → Task 7. File-backed tabs → Task 5. Default-dir-overridable → Tasks 3, 9. Autosave debounced → Task 4. File ops (new/rename/delete/drag) → Task 6. Migration → Task 8. Deferred watcher → Explorer uses focus-refresh (Task 6). Fixed-width sidebar → Task 6 (`w-[240px]`). Testing pure functions → Tasks 2,3,4,8.
- Gap acknowledged: History drawer's "open in tab" is parked (Task 7 Step 3) — out of scope for this iteration, documented, not silently dropped.

**Placeholder scan:** No TBD/TODO; every code step has full code. Context-menu simplification (rename / Shift-delete) is explicit, not a placeholder.

**Type consistency:** `TreeNode` type and CRUD names (`readTree`, `createFile`, `createDir`, `renameNode`, `removeNode`, `moveNode`) consistent across Tasks 2/6. `useFileTabs` returns `{ openFile, close, select, patch, retitle, closeByPath }` — all consumed in Task 7. `getRoot`/`setRootOverride`/`resolveRoot`/`Tool` consistent across Tasks 3/8/9. `saveFile`/`flushFiles` consistent (Task 4 → 5). `planMigration` signature consistent (Task 8).
