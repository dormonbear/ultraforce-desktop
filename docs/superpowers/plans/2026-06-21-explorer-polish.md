# Explorer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the History "open in tab" regression and round out the explorer with a resizable sidebar, search options (match-case/regex), a real right-click context menu, plus Playwright e2e coverage for the explorer.

**Architecture:** All work is in the `desktop/` React app on top of the file-backed explorer already on `main`. History "open in tab" is re-wired to write a per-tool `scratch.<ext>` file and open it (restoring the dead `consumePending` consumer). The sidebar gets wrapped in the existing `react-resizable-panels`. Search gains a pure-function matcher with case/regex options. A minimal radix `ContextMenu` replaces the Shift-click delete hack. The committed Playwright suite gets `plugin:fs`/`plugin:path` mocks (byte-array reads) so the explorer is exercised end-to-end.

**Tech Stack:** React 19, Tauri 2 (`@tauri-apps/plugin-fs`), `react-resizable-panels`, `radix-ui`, Vitest (node), Playwright.

## Global Constraints

- English for code/comments; no author attribution.
- Vitest runs in **node env** — only pure functions get unit tests; UI is covered by `tsc` + `pnpm build` + Playwright.
- **Playwright fs mocks MUST return a byte array** for `plugin:fs|read_text_file`/`read_file` (`Array.from(new TextEncoder().encode(s))`) — `readTextFile` does `Uint8Array.from(arr)` then decodes; a string yields all-NUL content.
- Project uses **pnpm**, not npm.
- Autosave/debounce unchanged (~400ms).
- Out of scope (YAGNI): live FS watcher (focus-refresh suffices), split/side-by-side editors.

---

### Task 1: Fix History "open in tab" regression (open a scratch file)

**Problem:** `HistoryDrawer` calls `requestOpenTab(tool, text)` but no panel consumes the pending text anymore (the explorer refactor dropped `consumePending`), so clicking a history entry switches panel and silently drops the query. `consumePending` is now dead.

**Files:**
- Modify: `desktop/src/tabs/useFileTabs.ts` (add `openOrReplace`)
- Modify: `desktop/src/panels/SoqlTabs.tsx` (consume pending → scratch file)
- Modify: `desktop/src/panels/ApexTabs.tsx` (same)

**Interfaces:**
- Consumes: `consumePending`, `onOpenTabRequest` from `../openTab`; `joinPath` from `../fs/paths`; `writeTextFile` from `@tauri-apps/plugin-fs`.
- Produces (useFileTabs): `openOrReplace(path: string, content: string): Promise<void>` — writes `content` to `path`, then shows it: patches the open tab's content field if open, else opens a new tab.

- [ ] **Step 1: Add `openOrReplace` to `useFileTabs`**

In `desktop/src/tabs/useFileTabs.ts`, add `writeTextFile` to the plugin-fs import:

```ts
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
```

Add this callback just after `openFile`:

```ts
  // Write `content` to `path` and show it (used by "open from history"):
  // patch an already-open tab, otherwise open a fresh one.
  const openOrReplace = useCallback(
    async (path: string, content: string) => {
      await writeTextFile(path, content);
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        patch(existing.id, { [contentKey]: content } as Partial<T>);
        setActiveId(existing.id);
        return;
      }
      const tab = make(path, content);
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
    },
    [tabs, make, patch, contentKey],
  );
```

Add `openOrReplace` to the returned object (next to `openFile`).

- [ ] **Step 2: Consume pending history text in `SoqlTabs`**

In `desktop/src/panels/SoqlTabs.tsx`, add imports:

```ts
import { consumePending, onOpenTabRequest } from "../openTab";
import { joinPath } from "../fs/paths";
```

Pull `openOrReplace` from the hook (add to the destructure). After the `root` effect, add:

```ts
  // History "open in tab" stages text via openTab; write it to scratch.soql.
  useEffect(() => {
    if (!root) return;
    const tryOpen = () => {
      const text = consumePending("soql");
      if (text != null) void openOrReplace(joinPath(root, "scratch.soql"), text);
    };
    tryOpen();
    return onOpenTabRequest((tool) => {
      if (tool === "soql") tryOpen();
    });
  }, [root, openOrReplace]);
```

- [ ] **Step 3: Same for `ApexTabs`**

In `desktop/src/panels/ApexTabs.tsx`, mirror Step 2 with `"apex"` and `joinPath(root, "scratch.apex")`.

- [ ] **Step 4: Type-check**

Run: `cd desktop && npx tsc --noEmit`
Expected: clean. `consumePending` is no longer dead.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/tabs/useFileTabs.ts desktop/src/panels/SoqlTabs.tsx desktop/src/panels/ApexTabs.tsx
git commit -m "fix(desktop): history open-in-tab writes a scratch file and opens it"
```

---

### Task 2: Resizable sidebar

**Files:**
- Modify: `desktop/src/components/Explorer.tsx` (drop fixed width)
- Modify: `desktop/src/panels/SoqlTabs.tsx` (wrap in ResizablePanelGroup)
- Modify: `desktop/src/panels/ApexTabs.tsx` (same)

**Interfaces:**
- Consumes: `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` from `@/components/ui/resizable`; `useDefaultLayout` from `react-resizable-panels`.

- [ ] **Step 1: Make Explorer fill its panel**

In `desktop/src/components/Explorer.tsx`, change the root div class from
`flex h-full w-[240px] shrink-0 flex-col ...` to `flex h-full w-full flex-col ...`
(remove `w-[240px] shrink-0`).

- [ ] **Step 2: Wrap SoqlTabs layout in a horizontal resizable group**

In `desktop/src/panels/SoqlTabs.tsx`, add imports:

```ts
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
```

Inside the component, before `return`:

```ts
  const layout = useDefaultLayout({
    id: "uf-soql-sidebar",
    panelIds: ["sidebar", "main"],
    storage: localStorage,
  });
```

Replace the outer `<div className="flex h-full">…</div>` with:

```tsx
    <ResizablePanelGroup
      direction="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="h-full"
    >
      <ResizablePanel id="sidebar" defaultSize="240px" minSize="160px" maxSize="420px">
        {root && (
          <Explorer
            root={root}
            ext="soql"
            activePath={active?.path ?? null}
            onOpen={(p, line) => void openFile(p, line)}
            onRenamed={retitle}
            onRemoved={closeByPath}
          />
        )}
      </ResizablePanel>
      <ResizableHandle className="w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />
      <ResizablePanel id="main" minSize="320px">
        <div className="flex h-full min-w-0 flex-col">
          {/* existing: active ? (TabStrip + SoqlView) : placeholder */}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
```

Move the existing `active ? (...) : (placeholder)` block into the `main` panel's inner div (it was the right-hand `<div className="flex min-w-0 flex-1 flex-col">` content).

- [ ] **Step 3: Same for ApexTabs**

Mirror Step 2 in `desktop/src/panels/ApexTabs.tsx` with `id: "uf-apex-sidebar"` and `ext="apex"`, `ApexView`.

- [ ] **Step 4: Build**

Run: `cd desktop && npm run build` (pnpm build)
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/Explorer.tsx desktop/src/panels/SoqlTabs.tsx desktop/src/panels/ApexTabs.tsx
git commit -m "feat(desktop): resizable explorer sidebar (persisted width)"
```

---

### Task 3: Search options — match case + regex

**Files:**
- Modify: `desktop/src/fs/search.ts` (matcher + options)
- Modify: `desktop/src/fs/search.test.ts` (option tests)
- Modify: `desktop/src/components/Explorer.tsx` (toggle UI + thread options)

**Interfaces:**
- Produces (`search.ts`):
  - `interface SearchOpts { caseSensitive?: boolean; regex?: boolean }`
  - `makeMatcher(query: string, opts?: SearchOpts): (s: string) => boolean` (invalid regex ⇒ never matches)
  - `filterTree(nodes, query, opts?)`, `findMatches(content, query, opts?)`, `searchContent(nodes, query, opts?)` all take optional `opts`.

- [ ] **Step 1: Write failing tests for the matcher**

Add to `desktop/src/fs/search.test.ts`:

```ts
import { makeMatcher, findMatches } from "./search";

describe("makeMatcher", () => {
  it("is case-insensitive by default", () => {
    expect(makeMatcher("name")("FROM Name")).toBe(true);
  });
  it("respects caseSensitive", () => {
    expect(makeMatcher("Name", { caseSensitive: true })("name")).toBe(false);
    expect(makeMatcher("Name", { caseSensitive: true })("Name")).toBe(true);
  });
  it("supports regex", () => {
    expect(makeMatcher("Acc.*t", { regex: true })("Account")).toBe(true);
  });
  it("invalid regex never matches", () => {
    expect(makeMatcher("(", { regex: true })("anything")).toBe(false);
  });
});

describe("findMatches with options", () => {
  it("regex matches whole-word via anchors", () => {
    const out = findMatches("Id\nName\nAccountName", "\\bName\\b", { regex: true });
    expect(out.map((m) => m.line)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd desktop && npx vitest run src/fs/search.test.ts`
Expected: FAIL (`makeMatcher` not exported).

- [ ] **Step 3: Implement matcher + thread options in `search.ts`**

Replace the body of `desktop/src/fs/search.ts` with:

```ts
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { TreeNode } from "./tree";

export interface SearchOpts {
  caseSensitive?: boolean;
  regex?: boolean;
}

/** Build a line/name predicate for `query`. Invalid regex never matches. */
export function makeMatcher(
  query: string,
  opts: SearchOpts = {},
): (s: string) => boolean {
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, opts.caseSensitive ? "" : "i");
    } catch {
      return () => false;
    }
    return (s) => re.test(s);
  }
  const q = opts.caseSensitive ? query : query.toLowerCase();
  return (s) => (opts.caseSensitive ? s : s.toLowerCase()).includes(q);
}

/** Prune the tree to files whose name matches, keeping ancestor dirs. */
export function filterTree(
  nodes: TreeNode[],
  query: string,
  opts?: SearchOpts,
): TreeNode[] {
  if (!query.trim()) return nodes;
  const match = makeMatcher(query.trim(), opts);
  const walk = (ns: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of ns) {
      if (n.kind === "dir") {
        const kids = walk(n.children ?? []);
        if (kids.length) out.push({ ...n, children: kids });
        else if (match(n.name)) out.push({ ...n, children: [] });
      } else if (match(n.name)) {
        out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}

export interface LineMatch {
  line: number;
  text: string;
}

/** Lines (1-based) of `content` matching `query`, trimmed. */
export function findMatches(
  content: string,
  query: string,
  opts?: SearchOpts,
): LineMatch[] {
  if (!query) return [];
  const match = makeMatcher(query, opts);
  const out: LineMatch[] = [];
  content.split("\n").forEach((text, i) => {
    if (match(text)) out.push({ line: i + 1, text: text.trim() });
  });
  return out;
}

export interface FileHit {
  path: string;
  name: string;
  matches: LineMatch[];
}

/** Read each file in `nodes` and collect content matches for `query`. */
export async function searchContent(
  nodes: TreeNode[],
  query: string,
  opts?: SearchOpts,
): Promise<FileHit[]> {
  if (!query.trim()) return [];
  const files: TreeNode[] = [];
  const collect = (ns: TreeNode[]) =>
    ns.forEach((n) =>
      n.kind === "dir" ? collect(n.children ?? []) : files.push(n),
    );
  collect(nodes);
  const hits: FileHit[] = [];
  for (const f of files) {
    try {
      const matches = findMatches(await readTextFile(f.path), query, opts);
      if (matches.length) hits.push({ path: f.path, name: f.name, matches });
    } catch {
      /* unreadable file — skip */
    }
  }
  return hits;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd desktop && npx vitest run src/fs/search.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Add toggle UI in Explorer and thread options**

In `desktop/src/components/Explorer.tsx`:
- Import: add `type SearchOpts` to the `../fs/search` import.
- Add state: `const [opts, setOpts] = useState<SearchOpts>({});`
- Change `nameFilter`/`shown`: `const shown = nameFilter ? filterTree(tree, nameFilter, opts) : tree;`
- Change `runContentSearch`: `void searchContent(tree, q, opts).then(setHits);`
- In the search row (after the mode toggle button), add two small toggles:

```tsx
        <button
          type="button"
          aria-label="Match case"
          title="Match case"
          onClick={() => setOpts((o) => ({ ...o, caseSensitive: !o.caseSensitive }))}
          className={`shrink-0 rounded px-1 text-[10px] font-medium ${
            opts.caseSensitive ? "bg-primary/15 text-primary" : "text-text-dim hover:text-foreground"
          }`}
        >
          Aa
        </button>
        <button
          type="button"
          aria-label="Use regular expression"
          title="Use regular expression"
          onClick={() => setOpts((o) => ({ ...o, regex: !o.regex }))}
          className={`shrink-0 rounded px-1 text-[10px] font-medium ${
            opts.regex ? "bg-primary/15 text-primary" : "text-text-dim hover:text-foreground"
          }`}
        >
          .*
        </button>
```

Re-run content search when options change while in content mode: add

```ts
  useEffect(() => {
    if (mode === "content" && query.trim()) runContentSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);
```

(The mode toggle button label `Aa`/`Txt` stays; the new `Aa` here is the case toggle — rename the mode toggle's `Aa` label to `Name` to avoid confusion: in the mode button, `{mode === "name" ? "Name" : "Txt"}`.)

- [ ] **Step 6: Type-check + tests + build**

Run: `cd desktop && npx tsc --noEmit && npx vitest run src/fs && pnpm build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/fs/search.ts desktop/src/fs/search.test.ts desktop/src/components/Explorer.tsx
git commit -m "feat(desktop): match-case + regex options for explorer search"
```

---

### Task 4: Real right-click context menu

**Files:**
- Create: `desktop/src/components/ui/context-menu.tsx`
- Modify: `desktop/src/components/TreeNode.tsx` (drop `onContextMenu` prop)
- Modify: `desktop/src/components/Explorer.tsx` (wrap rows in ContextMenu)

**Interfaces:**
- Produces (`context-menu.tsx`): `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator` (thin radix wrappers).

- [ ] **Step 1: Add the context-menu primitive**

Create `desktop/src/components/ui/context-menu.tsx`:

```tsx
import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card p-1 text-[12px] text-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1 outline-none data-[highlighted]:bg-primary/15 data-[highlighted]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
```

- [ ] **Step 2: Drop `onContextMenu` from TreeNode**

In `desktop/src/components/TreeNode.tsx`, remove the `onContextMenu` prop from the `Props` interface and from the rendered `<div>` (`onContextMenu={p.onContextMenu}`).

- [ ] **Step 3: Wrap each tree row in a ContextMenu in Explorer**

In `desktop/src/components/Explorer.tsx`:
- Import: `import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "./ui/context-menu";`
- Delete the `onContextMenu` handler function and the `editing`-unrelated Shift-click logic.
- In `walk`, replace the bare `<TreeNode .../>` push with a wrapped version (keep the `key` on the outer `ContextMenu`-wrapping element):

```tsx
      rows.push(
        <ContextMenu key={n.path}>
          <ContextMenuTrigger asChild>
            <div>
              <TreeNode
                node={n}
                depth={depth}
                expanded={isOpen}
                active={n.path === activePath}
                editing={edit?.kind === "rename" && edit.path === n.path}
                onToggle={() => toggle(n.path)}
                onOpen={() => onOpen(n.path)}
                onCommitName={commitName}
                onCancelEdit={() => setEdit(null)}
                onDragStartNode={() => setDrag(n.path)}
                onDropOnDir={() => void drop(n.path)}
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() =>
                setEdit({
                  kind: "new-file",
                  dir: n.kind === "dir" ? n.path : dirname(n.path),
                })
              }
            >
              New File
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                setEdit({
                  kind: "new-dir",
                  dir: n.kind === "dir" ? n.path : dirname(n.path),
                })
              }
            >
              New Folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setEdit({ kind: "rename", path: n.path })}>
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive data-[highlighted]:bg-destructive/15 data-[highlighted]:text-destructive"
              onSelect={() => void del(n)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      );
```

Note: a `new-file`/`new-dir` started from a nested dir needs that dir expanded to show the `NewRow`. For v1 the `NewRow` only renders at root (existing behavior); creating inside a collapsed dir still creates the file (refresh shows it). Keep as-is — the `dir` passed to `createFile`/`createDir` is correct.

- [ ] **Step 4: Type-check + build**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
Expected: green. (`onContextMenu` references removed everywhere.)

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/ui/context-menu.tsx desktop/src/components/TreeNode.tsx desktop/src/components/Explorer.tsx
git commit -m "feat(desktop): real right-click context menu in the explorer"
```

---

### Task 5: Playwright e2e for the explorer + housekeeping

**Files:**
- Modify: `desktop/e2e/fixtures.ts` (add path/fs mocks)
- Modify: `desktop/e2e/ultraforce.spec.ts` (explorer specs)
- Create: `.gitignore` entries (root)

**Interfaces:**
- Consumes: existing `gotoApp(page)` helper.

- [ ] **Step 1: Add fs/path mocks to fixtures**

In `desktop/e2e/fixtures.ts`, define a fake workspace and handle the new plugin channels inside the `invoke` shim. Add near the top (module scope):

```ts
const WS = "/ws";
const FAKE_DIRS: Record<string, { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }[]> = {
  [`${WS}/workspace/soql`]: [
    { name: "accounts.soql", isDirectory: false, isFile: true, isSymlink: false },
    { name: "leads.soql", isDirectory: false, isFile: true, isSymlink: false },
  ],
  [`${WS}/workspace/apex`]: [
    { name: "hello.apex", isDirectory: false, isFile: true, isSymlink: false },
  ],
};
const FAKE_FILES: Record<string, string> = {
  [`${WS}/workspace/soql/accounts.soql`]: "SELECT Id, Name, AnnualRevenue FROM Account",
  [`${WS}/workspace/soql/leads.soql`]: "SELECT Id, Company FROM Lead",
  [`${WS}/workspace/apex/hello.apex`]: "System.debug('hi');",
};
```

In the `invoke` function, before the final `return`, add:

```ts
      if (cmd.startsWith("plugin:path|")) return Promise.resolve(WS);
      if (cmd === "plugin:fs|read_dir") {
        return Promise.resolve(FAKE_DIRS[(args as { path: string }).path] ?? []);
      }
      if (cmd === "plugin:fs|exists") return Promise.resolve(true);
      if (cmd === "plugin:fs|mkdir") return Promise.resolve(null);
      if (cmd === "plugin:fs|read_text_file" || cmd === "plugin:fs|read_file") {
        const p = (args as { path: string }).path;
        return Promise.resolve(
          Array.from(new TextEncoder().encode(FAKE_FILES[p] ?? "")),
        );
      }
      if (cmd === "plugin:fs|write_text_file" || cmd === "plugin:fs|write_file") {
        const a = args as { path: string; data?: string };
        if (a.data != null) FAKE_FILES[a.path] = a.data;
        return Promise.resolve(null);
      }
      if (cmd.startsWith("plugin:fs|")) return Promise.resolve(null);
```

(The store `get` already returns `[null, false]` for unknown keys, so no tabs hydrate and `migrated.explorer` is falsy — fine.)

- [ ] **Step 2: Add explorer e2e specs**

Append to `desktop/e2e/ultraforce.spec.ts`:

```ts
test("explorer lists files and opens one in a tab", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByText("accounts.soql")).toBeVisible();
  await page.getByText("accounts.soql").click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
});

test("name filter prunes the tree", async ({ page }) => {
  await gotoApp(page);
  await page.getByPlaceholder("Filter by name").fill("lead");
  await expect(page.getByText("leads.soql")).toBeVisible();
  await expect(page.getByText("accounts.soql")).toHaveCount(0);
});

test("content search finds a line and opens the file", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Toggle search mode" }).click();
  const box = page.getByPlaceholder("Search in files");
  await box.fill("AnnualRevenue");
  await box.press("Enter");
  await expect(page.getByText("accounts.soql", { exact: false })).toBeVisible();
  await page.getByText("SELECT Id, Name, AnnualRevenue", { exact: false }).click();
  await expect(page.getByRole("tab", { name: /accounts\.soql/ })).toBeVisible();
});
```

- [ ] **Step 3: Run e2e**

Run: `cd desktop && pnpm exec playwright test 2>&1 | tail -20`
Expected: all specs pass (existing + 3 new). If a spec is flaky on first Monaco mount, the assertions above target the sidebar/tab (not Monaco) and should be stable.

- [ ] **Step 4: gitignore local junk**

Create/append `.gitignore` at the repo root with:

```
.playwright-mcp/
node-compile-cache/
reference-source/
reference-analysis/
sf-apex-panel.png
sf-logs-panel.png
sf-toolkit-desktop.png
```

- [ ] **Step 5: Commit**

```bash
git add desktop/e2e/fixtures.ts desktop/e2e/ultraforce.spec.ts .gitignore
git commit -m "test(desktop): e2e coverage for explorer + gitignore local junk"
```

---

## Self-Review

**Spec coverage:** #1 history regression → Task 1. #4 resizable sidebar → Task 2. #7 search options → Task 3. #6 context menu → Task 4. e2e + #8 gitignore → Task 5. FS watcher (#3) and split editors (#5) explicitly out of scope (Global Constraints). #2 (native GUI smoke) and #9 (real-org e2e) remain human/org-gated — not code tasks.

**Placeholder scan:** No TBD/TODO; every code step has full code. The "existing block moves into the main panel" note in Task 2 references concrete existing code, not a placeholder.

**Type consistency:** `openOrReplace(path, content)` defined in Task 1, consumed in Task 1 Steps 2–3. `SearchOpts`/`makeMatcher`/`filterTree`/`findMatches`/`searchContent` signatures consistent across Task 3 and Task 5 mocks. `ContextMenu*` exports defined in Task 4 Step 1, used in Step 3. TreeNode `onContextMenu` removed in Task 4 Step 2 and its Explorer caller removed in Step 3 (consistent). Playwright fs mock returns byte arrays per Global Constraints.
