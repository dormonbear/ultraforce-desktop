# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all app configuration into a dedicated Settings page rendered in the main content area, reached from a gear icon pinned to the bottom-left of the activity rail.

**Architecture:** Settings becomes a fourth `ActivePanel` value (`"settings"`) that is NOT part of the `RAIL` tool array. A new `SettingsPage` component absorbs the logic currently in `WorkspaceSettings` (workspace roots, index scope) plus theme and an About section. The top-bar gear and Sun/Moon buttons are removed; a gear button is added at the bottom of the rail via `mt-auto`.

**Tech Stack:** React, TypeScript, Tauri v2 (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`), lucide-react, shadcn/ui, Tailwind, vitest.

## Global Constraints

- Reuse existing config primitives unchanged: `fs/workspace.ts` (`getRoot`, `setRootOverride`, `type Tool = "soql" | "apex"`), `indexSettings.ts` (`getNamespacePolicy`, `setNamespacePolicy`), `theme.tsx` (`useTheme() -> { theme, toggle }`), `updater.ts` (`checkForUpdates`).
- App version via `getVersion` from `@tauri-apps/api/app`.
- Match existing component styling: `text-[12px]`, `border-border`, `bg-card`, `text-text-dim`, `text-foreground`, `text-primary`, `bg-primary/15`.
- No new persisted settings beyond what exists today. No new component test harness (App/page layer is Tauri-bound; spec says none).
- Verification per task: `pnpm build` (runs `tsc` typecheck + vite build), `pnpm test` (existing vitest suite stays green), `pnpm lint`.
- Commits: conventional commits, no author attribution.

---

## File Structure

- **Create** `desktop/src/components/SettingsPage.tsx` — the settings view (sections: Appearance, Workspace, Indexing, About).
- **Modify** `desktop/src/App.tsx` — extend `ActivePanel`; remove top-bar gear + theme button; add bottom-rail Settings button; settings-first main render branch; `⌘,`/`Ctrl+,` shortcut.
- **Delete** `desktop/src/components/WorkspaceSettings.tsx` — logic absorbed into `SettingsPage`.
- **Modify** `desktop/src/components/CommandPalette.tsx` — add a "Go to Settings" entry.

All paths below are relative to repo root. Run commands from `desktop/`.

---

### Task 1: Create the SettingsPage component

**Files:**
- Create: `desktop/src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes: `getRoot`, `setRootOverride`, `type Tool` from `../fs/workspace`; `getNamespacePolicy`, `setNamespacePolicy` from `../indexSettings`; `useOrgs` from `../org`; `useTheme` from `../theme`; `checkForUpdates` from `../updater`; `getVersion` from `@tauri-apps/api/app`; `open` from `@tauri-apps/plugin-dialog`; `invoke` from `@tauri-apps/api/core`; `toast` from `sonner`; `Button` from `@/components/ui/button`.
- Produces: `export function SettingsPage({ onChanged }: { onChanged: () => void })` — `onChanged` is called after a workspace root changes so the parent can remount the affected tool panel.

- [ ] **Step 1: Create the component file**

Create `desktop/src/components/SettingsPage.tsx` with exactly this content:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { getRoot, setRootOverride, type Tool } from "../fs/workspace";
import { getNamespacePolicy, setNamespacePolicy } from "../indexSettings";
import { useOrgs } from "../org";
import { useTheme } from "../theme";
import { checkForUpdates } from "../updater";
import { Button } from "@/components/ui/button";

interface Props {
  /** Called after a workspace root changes so the owner can remount the panel. */
  onChanged: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] uppercase tracking-wide text-text-dim">{title}</h2>
      <div className="rounded-md border border-border bg-card p-3">{children}</div>
    </section>
  );
}

/** Full settings center: appearance, per-tool workspace roots, index scope, about. */
export function SettingsPage({ onChanged }: Props) {
  const { selected: org } = useOrgs();
  const { theme, toggle } = useTheme();
  const [roots, setRoots] = useState<Record<Tool, string>>({ soql: "", apex: "" });
  const [ns, setNs] = useState<string>("all");
  const [version, setVersion] = useState("");

  useEffect(() => {
    void Promise.all([getRoot("soql"), getRoot("apex")]).then(([soql, apex]) =>
      setRoots({ soql, apex }),
    );
    void getNamespacePolicy().then(setNs);
    void getVersion().then(setVersion);
  }, []);

  // Change the index namespace scope and reindex the active org so it takes effect.
  const changeNs = async (value: string) => {
    setNs(value);
    await setNamespacePolicy(value);
    if (org) {
      await invoke("reindex_org", { org, namespaces: value }).catch((e) =>
        toast.error(`Reindex failed: ${typeof e === "string" ? e : String(e)}`),
      );
      toast.success("Reindexing org…");
    }
  };

  const pick = async (tool: Tool) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    await setRootOverride(tool, dir);
    setRoots((r) => ({ ...r, [tool]: dir }));
    onChanged();
  };

  const reset = async (tool: Tool) => {
    await setRootOverride(tool, null);
    const next = await getRoot(tool);
    setRoots((r) => ({ ...r, [tool]: next }));
    onChanged();
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 text-[12px]">
        <h1 className="text-base font-medium text-foreground">Settings</h1>

        <Section title="Appearance">
          <div className="flex items-center justify-between">
            <span className="text-foreground">Theme</span>
            <div className="flex gap-1 rounded-md border border-border p-0.5">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (theme !== t) toggle();
                  }}
                  className={`cursor-pointer rounded px-3 py-1 capitalize ${
                    theme === t
                      ? "bg-primary/15 text-primary"
                      : "text-text-dim hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Workspace">
          <div className="flex flex-col gap-3">
            {(["soql", "apex"] as Tool[]).map((tool) => (
              <div key={tool} className="flex flex-col gap-1">
                <span className="uppercase tracking-wide text-text-dim">
                  {tool} workspace
                </span>
                <span className="truncate text-foreground" title={roots[tool]}>
                  {roots[tool] || "…"}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void pick(tool)}
                    className="cursor-pointer rounded-md bg-primary/15 px-2 py-0.5 text-primary hover:bg-primary/25"
                  >
                    Change…
                  </button>
                  <button
                    type="button"
                    onClick={() => void reset(tool)}
                    className="cursor-pointer rounded-md px-2 py-0.5 text-text-dim hover:text-foreground"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Indexing">
          <div className="flex flex-col gap-1">
            <span className="uppercase tracking-wide text-text-dim">index scope</span>
            <select
              value={ns}
              onChange={(e) => void changeNs(e.target.value)}
              className="cursor-pointer rounded-md border border-border bg-transparent px-2 py-1 text-foreground"
              aria-label="Index namespace scope"
            >
              <option value="all">All objects</option>
              <option value="unmanaged">Unmanaged only (skip managed packages)</option>
            </select>
          </div>
        </Section>

        <Section title="About">
          <div className="flex items-center justify-between">
            <span className="text-foreground">
              Ultraforce{version && ` v${version}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void checkForUpdates()}
              className="cursor-pointer text-text-dim hover:text-foreground"
            >
              Check for updates
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the new file**

Run from `desktop/`: `pnpm build`
Expected: PASS (tsc compiles, no type errors). The component is unused so far — that is fine; exported symbols are not flagged.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/SettingsPage.tsx
git commit -m "feat(settings): add SettingsPage with appearance, workspace, indexing, about"
```

---

### Task 2: Wire SettingsPage into App and remove old gear/theme buttons

**Files:**
- Modify: `desktop/src/App.tsx`
- Delete: `desktop/src/components/WorkspaceSettings.tsx`

**Interfaces:**
- Consumes: `SettingsPage` from Task 1 (`export function SettingsPage({ onChanged }: { onChanged: () => void })`).
- Produces: `ActivePanel` type now includes `"settings"` (consumed by Task 3's `CommandPalette` via `onSelectPanel`).

- [ ] **Step 1: Update imports in `desktop/src/App.tsx`**

Replace the lucide-react import block (currently importing `Database, Terminal, ScrollText, Table as TableIcon, Sun, Moon, History as HistoryIcon, Command as CommandIcon`) with this — drop `Sun` and `Moon`, add `Settings`:

```tsx
import {
  Database,
  Terminal,
  ScrollText,
  Table as TableIcon,
  History as HistoryIcon,
  Command as CommandIcon,
  Settings,
} from "lucide-react";
```

Replace the WorkspaceSettings import line:

```tsx
import { WorkspaceSettings } from "./components/WorkspaceSettings";
```

with:

```tsx
import { SettingsPage } from "./components/SettingsPage";
```

- [ ] **Step 2: Extend the ActivePanel type**

Change:

```tsx
type ActivePanel = "soql" | "apex" | "logs";
```

to:

```tsx
type ActivePanel = "soql" | "apex" | "logs" | "settings";
```

- [ ] **Step 3: Drop the now-unused theme toggle locals**

Change:

```tsx
  const { theme, toggle } = useTheme();
  const themeTitle = theme === "dark" ? "Switch to light" : "Switch to dark";
```

to (keep `theme` — it is still used by `<Toaster theme={theme} />`):

```tsx
  const { theme } = useTheme();
```

- [ ] **Step 4: Add the `⌘,` / `Ctrl+,` shortcut**

In the first keydown effect (the one handling `⌘K`), extend the handler. Change:

```tsx
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
```

to:

```tsx
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((open) => !open);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setActive("settings");
      }
    };
```

- [ ] **Step 5: Remove the top-bar gear and theme buttons**

In the header's right-side `<div className="flex items-center gap-2">`, delete the `WorkspaceSettings` line:

```tsx
          <WorkspaceSettings onChanged={() => setWsVersion((v) => v + 1)} />
```

and delete the entire theme-toggle `Tooltip` block:

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label="Toggle color theme"
                className="size-7 cursor-pointer text-text-dim hover:text-foreground"
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{themeTitle}</TooltipContent>
          </Tooltip>
```

Leave `IndexProgress`, `SchemaRefresh`, the Command-palette button, the History button, and `OrgSelector` intact.

- [ ] **Step 6: Add the Settings button at the bottom of the rail**

In the `<nav>` activity rail, immediately after the closing `)}` of the `RAIL.map(...)` block and before `</nav>`, add the bottom-pinned Settings button:

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                aria-current={active === "settings" ? "page" : undefined}
                onClick={() => setActive("settings")}
                className={`focus-accent relative mt-auto mb-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md ${
                  active === "settings"
                    ? "text-primary"
                    : "text-text-dim hover:text-foreground"
                }`}
              >
                {active === "settings" && (
                  <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded bg-primary" />
                )}
                <Settings size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Settings
              <span className="ml-2 text-muted-foreground">
                {isMac() ? "⌘," : "Ctrl+,"}
              </span>
            </TooltipContent>
          </Tooltip>
```

- [ ] **Step 7: Add the settings-first main render branch**

Replace the `<main>` body. Change:

```tsx
        <main className="min-w-0 flex-1">
          {needsSetup ? (
            <SetupPage />
          ) : (
            <>
```

to:

```tsx
        <main className="min-w-0 flex-1">
          {active === "settings" ? (
            <SettingsPage onChanged={() => setWsVersion((v) => v + 1)} />
          ) : needsSetup ? (
            <SetupPage />
          ) : (
            <>
```

(The closing `)}` of this ternary stays as-is — the existing `</>` then `)}` now closes the third branch.)

- [ ] **Step 8: Delete the old component**

```bash
git rm desktop/src/components/WorkspaceSettings.tsx
```

- [ ] **Step 9: Typecheck and run tests**

Run from `desktop/`: `pnpm build && pnpm test`
Expected: build PASS (no type errors — confirms no dangling `WorkspaceSettings`, `Sun`, `Moon`, `toggle`, or `themeTitle` references), tests PASS (existing suite unaffected).

- [ ] **Step 10: Lint**

Run from `desktop/`: `pnpm lint`
Expected: no new errors in `App.tsx` / `SettingsPage.tsx`.

- [ ] **Step 11: Commit**

```bash
git add desktop/src/App.tsx
git commit -m "feat(settings): move config to bottom-rail Settings page, drop top-bar gear and theme buttons"
```

---

### Task 3: Add a Settings entry to the command palette

**Files:**
- Modify: `desktop/src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `onSelectPanel(panel: PanelId)` already wired to `setActive` in `App.tsx`; `ActivePanel` now includes `"settings"` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Import the Settings icon**

Change the lucide-react import:

```tsx
import { Database, History, Moon, ScrollText, Terminal } from "lucide-react";
```

to:

```tsx
import { Database, History, Moon, ScrollText, Settings, Terminal } from "lucide-react";
```

- [ ] **Step 2: Extend the PanelId type**

Change:

```tsx
type PanelId = "soql" | "apex" | "logs";
```

to:

```tsx
type PanelId = "soql" | "apex" | "logs" | "settings";
```

- [ ] **Step 3: Add the Settings entry to PANELS**

Change:

```tsx
const PANELS: Array<{ id: PanelId; label: string; icon: typeof Database }> = [
  { id: "soql", label: "Go to SOQL", icon: Database },
  { id: "apex", label: "Go to Apex", icon: Terminal },
  { id: "logs", label: "Go to Logs", icon: ScrollText },
];
```

to:

```tsx
const PANELS: Array<{ id: PanelId; label: string; icon: typeof Database }> = [
  { id: "soql", label: "Go to SOQL", icon: Database },
  { id: "apex", label: "Go to Apex", icon: Terminal },
  { id: "logs", label: "Go to Logs", icon: ScrollText },
  { id: "settings", label: "Go to Settings", icon: Settings },
];
```

- [ ] **Step 4: Typecheck**

Run from `desktop/`: `pnpm build`
Expected: PASS. `onSelectPanel={setActive}` accepts `"settings"` because `ActivePanel` includes it.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/CommandPalette.tsx
git commit -m "feat(settings): add Settings entry to command palette"
```

---

## Manual verification (after all tasks)

Run `pnpm tauri dev` from `desktop/` and confirm:
- [ ] Gear icon sits at the **bottom-left** of the activity rail; clicking it opens the Settings page in the main area with the rail item highlighted.
- [ ] Top bar no longer shows the gear or the Sun/Moon theme button.
- [ ] Appearance: Light/Dark control switches theme and reflects the active choice.
- [ ] Workspace: SOQL and Apex rows show current paths; Change… opens a folder picker and updates the path; Reset reverts to default; switching back to a tool reflects the new root.
- [ ] Indexing: changing index scope persists and triggers a reindex toast when an org is selected.
- [ ] About: shows `Ultraforce vX.Y.Z`; Check for updates runs without error.
- [ ] `⌘,` (or `Ctrl+,`) opens Settings; the command palette "Go to Settings" entry opens Settings.
- [ ] Settings is reachable even when no org is connected (no SetupPage override).

## Self-Review notes

- Spec coverage: rail bottom button (Task 2 Step 6), main render order settings→setup→tools (Task 2 Step 7), SettingsPage four sections (Task 1), delete WorkspaceSettings (Task 2 Step 8), remove top-bar gear+theme (Task 2 Step 5), `⌘,` (Task 2 Step 4), palette entry (Task 3). All covered.
- Type consistency: `ActivePanel` and `PanelId` both extended to include `"settings"`; `SettingsPage` prop `onChanged` matches the `setWsVersion` callback used in Task 2 Step 7. `useTheme` exposes only `toggle` (no `setTheme`); Appearance uses `toggle` guarded by `theme !== t`.
- No placeholders; every code step shows full content.
