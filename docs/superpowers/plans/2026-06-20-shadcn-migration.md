# shadcn/ui Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SF·TOOLKIT's hand-rolled UI components with shadcn/ui equivalents (keeping the Cursor editorial look and light/dark theming), and add a ⌘K command palette + Sonner toasts.

**Architecture:** Dual-token bridge — shadcn semantic CSS vars (`--background`, `--primary`, …) and the existing Cursor `--color-*` tokens both resolve to the SAME Cursor palette, so migrated and un-migrated components stay visually identical. Dark mode switches to shadcn's `.dark` class convention. Components are copied in via the shadcn CLI (we own the code under `src/components/ui/`).

**Tech Stack:** Tauri 2 + React 19 + Vite + Tailwind v4 + pnpm + lucide. New: clsx, tailwind-merge, class-variance-authority, tailwindcss-animate, @radix-ui/*, cmdk, sonner.

## Global Constraints

- Package manager is **pnpm**. Use `pnpm`/`pnpm dlx`, never npm/npx.
- Working dir for all frontend commands: `desktop/`. Branch: `feat/shadcn-migration`. NEVER `git push`.
- The Cursor visual language must NOT change — this is a component-layer swap; the look stays identical in BOTH light and dark.
- tsconfig has `noUnusedLocals` + `noUnusedParameters` — every file must compile with zero unused symbols.
- Per-task verification (this project has NO JS test framework — do not add one): `npx tsc --noEmit` AND `pnpm build` must both pass. (Visual light/dark screenshot verification is done by the reviewer after delegation, not by the executor.)
- KEEP and do NOT rewrite: closable `TabStrip`, `RecordTree`, `LogView`, Monaco wrappers (`SoqlEditor`, `ApexPanel` editor), the activity rail in `App.tsx`, the `.micro-label` pattern.
- KEEP result-table virtualization (`@tanstack/react-table` + `@tanstack/react-virtual`) — apply shadcn Table *styling* only.
- shadcn CLI must run non-interactively: `pnpm dlx shadcn@latest add <c> --yes --overwrite`. If the CLI or its network access fails, STOP and report BLOCKED (do not hand-author component files).

---

## Task 1: Toolchain setup (alias, cn, components.json, deps)

**Files:**
- Modify: `desktop/vite.config.ts`
- Modify: `desktop/tsconfig.json`
- Create: `desktop/src/lib/utils.ts`
- Create: `desktop/components.json`

- [ ] **Step 1: Add `@` alias to vite.config.ts**

Add `import path from "node:path";` at the top and `resolve` to the config:
```ts
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
```

- [ ] **Step 2: Add path mapping to tsconfig.json `compilerOptions`**

```jsonc
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
```

- [ ] **Step 3: Install dependencies**

Run:
```bash
cd desktop && pnpm add clsx tailwind-merge class-variance-authority tailwindcss-animate cmdk sonner
```

- [ ] **Step 4: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 6: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
Expected: both pass.
```bash
git add desktop/vite.config.ts desktop/tsconfig.json desktop/src/lib/utils.ts desktop/components.json desktop/package.json desktop/pnpm-lock.yaml
git commit -m "chore(desktop): scaffold shadcn toolchain (alias, cn, components.json, deps)"
```

---

## Task 2: Token bridge + `.dark` alignment

**Files:**
- Modify: `desktop/src/styles.css` (full rewrite below)
- Modify: `desktop/src/theme.tsx`

**Interfaces:**
- Produces: shadcn semantic tokens (`--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--success`, `--border`, `--input`, `--ring`, `--radius` and their `-foreground` pairs) AND the kept Cursor `--color-*` utilities, all mapped to one palette. Dark mode = `.dark` class on `<html>`.

- [ ] **Step 1: Rewrite `src/styles.css`**

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap");
@import "tailwindcss";
@plugin "tailwindcss-animate";

@custom-variant dark (&:is(.dark *));

/* shadcn semantic tokens — Cursor light palette (hex kept, not OKLCH). */
:root {
  --background: #f7f7f4;
  --foreground: #26251e;
  --card: #ffffff;
  --card-foreground: #26251e;
  --popover: #ffffff;
  --popover-foreground: #26251e;
  --primary: #f54e00;
  --primary-foreground: #ffffff;
  --secondary: #fafaf7;
  --secondary-foreground: #26251e;
  --muted: #fafaf7;
  --muted-foreground: #807d72;
  --accent: #e6e5e0;
  --accent-foreground: #26251e;
  --destructive: #cf2d56;
  --destructive-foreground: #ffffff;
  --success: #1f8a65;
  --success-foreground: #ffffff;
  --border: #e6e5e0;
  --input: #e6e5e0;
  --ring: #f54e00;
  --radius: 0.5rem;
  /* Cursor extras kept for un-migrated bespoke components */
  --c-surface-strong: #e6e5e0;
  --c-line: #cfcdc4;
  --c-text-dim: #5a5852;
  --c-amber: #c08532;
  --c-blue: #5a5852;
}

.dark {
  --background: #1a1916;
  --foreground: #f2f1ec;
  --card: #26241f;
  --card-foreground: #f2f1ec;
  --popover: #26241f;
  --popover-foreground: #f2f1ec;
  --primary: #ff5a14;
  --primary-foreground: #1a1611;
  --secondary: #211f1b;
  --secondary-foreground: #f2f1ec;
  --muted: #211f1b;
  --muted-foreground: #8c887d;
  --accent: #383530;
  --accent-foreground: #f2f1ec;
  --destructive: #ff6d8a;
  --destructive-foreground: #1a1611;
  --success: #3fb488;
  --success-foreground: #1a1611;
  --border: #33302a;
  --input: #33302a;
  --ring: #ff5a14;
  --c-surface-strong: #383530;
  --c-line: #48443c;
  --c-text-dim: #bdb9ae;
  --c-amber: #d9a23f;
  --c-blue: #bdb9ae;
}

/* Expose both the shadcn names and the kept Cursor names to Tailwind v4. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);

  /* Kept Cursor token names → same palette (so un-migrated code is unchanged). */
  --color-bg: var(--background);
  --color-surface: var(--card);
  --color-surface-2: var(--secondary);
  --color-surface-3: var(--c-surface-strong);
  --color-hair: var(--border);
  --color-line: var(--c-line);
  --color-text: var(--foreground);
  --color-text-dim: var(--c-text-dim);
  --color-text-faint: var(--muted-foreground);
  --color-accent-press: #d04200;
  --color-red: var(--destructive);
  --color-amber: var(--c-amber);
  --color-blue: var(--c-blue);

  --font-sans: "Inter", system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-display: "Inter", system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
}
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  font-feature-settings: "tnum" 1;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  transition: background 0.2s ease, color 0.2s ease;
}

.micro-label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.88px;
  text-transform: uppercase;
  color: var(--muted-foreground);
  user-select: none;
}
.micro-label::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border);
}
.tnum {
  font-variant-numeric: tabular-nums;
}
.focus-accent:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--background), 0 0 0 3px var(--ring);
}
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.spin {
  animation: spin 0.8s linear infinite;
}
```

- [ ] **Step 2: Change `theme.tsx` to toggle the `.dark` class**

In `src/theme.tsx`, replace the `useEffect` body that sets `document.documentElement.dataset.theme = theme` with:
```ts
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(KEY, theme);
  }, [theme]);
```
(Leave `initialTheme`, `monacoTheme`, `useTheme`, `toggle` unchanged.)

- [ ] **Step 3: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/styles.css desktop/src/theme.tsx
git commit -m "feat(desktop): bridge Cursor tokens to shadcn semantic tokens + .dark class"
```

---

## Task 3: Button + Badge

**Files:**
- Create (via CLI): `desktop/src/components/ui/button.tsx`, `desktop/src/components/ui/badge.tsx`
- Modify: `desktop/src/components/RunButton.tsx`, `desktop/src/panels/ApexPanel.tsx` (StatusChip), `desktop/src/panels/LogsPanel.tsx` (status text/dot)

- [ ] **Step 1: Add components**

```bash
cd desktop && pnpm dlx shadcn@latest add button badge --yes --overwrite
```

- [ ] **Step 2: Add `success` Badge variant**

In `src/components/ui/badge.tsx`, add a `success` entry to the cva `variants.variant` map:
```ts
        success:
          "border-transparent bg-success/15 text-success [a&]:hover:bg-success/25",
```

- [ ] **Step 3: Rewrite `RunButton.tsx` to use `Button`**

Read the existing `RunButton` props/markup; reimplement its body with `<Button>` from `@/components/ui/button` (default variant = primary). Preserve the same props, the play icon, the `running` disabled/spinner state, and the existing `onRun` callback. Keep its file path and exported name.

- [ ] **Step 4: Rewrite the status indicators to `Badge`**

- `ApexPanel.tsx` `StatusChip`: replace the hand-rolled span with `<Badge variant={ok ? "success" : "destructive"}>` keeping the dot + label.
- `LogsPanel.tsx` per-row status: replace the `text-success/text-red` span with `<Badge variant={ok ? "success" : "destructive"}>{log.status}</Badge>` (keep the colored dot if desired, or fold into the badge).

- [ ] **Step 5: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/button.tsx desktop/src/components/ui/badge.tsx desktop/src/components/RunButton.tsx desktop/src/panels/ApexPanel.tsx desktop/src/panels/LogsPanel.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): migrate RunButton + status indicators to shadcn Button/Badge"
```

---

## Task 4: Select (DebugConfigRow)

**Files:**
- Create (via CLI): `desktop/src/components/ui/select.tsx`
- Modify: `desktop/src/panels/DebugConfigRow.tsx`

- [ ] **Step 1: Add component**

```bash
cd desktop && pnpm dlx shadcn@latest add select --yes --overwrite
```

- [ ] **Step 2: Replace the native `<select>` level pickers + preset with shadcn `Select`**

In `DebugConfigRow.tsx`, replace each of the 11 native category-level `<select>` elements and the preset dropdown with the shadcn `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` composition. Preserve: the option sets (the `LEVELS`/preset arrays already defined in the file), the controlled `value`, and the existing `onChange`/state-update callbacks (wire `onValueChange` to them). Keep the grid layout + `.micro-label` markup around them.

- [ ] **Step 3: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/select.tsx desktop/src/panels/DebugConfigRow.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): migrate debug-level pickers to shadcn Select"
```

---

## Task 5: DropdownMenu (OrgSelector)

**Files:**
- Create (via CLI): `desktop/src/components/ui/dropdown-menu.tsx`
- Modify: `desktop/src/components/OrgSelector.tsx`

- [ ] **Step 1: Add component**

```bash
cd desktop && pnpm dlx shadcn@latest add dropdown-menu --yes --overwrite
```

- [ ] **Step 2: Rewrite `OrgSelector` with `DropdownMenu`**

Replace the hand-rolled open/close dropdown (and its outside-click `useEffect`) with `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`. Preserve: `list_orgs` fetch, default-org selection, `set_target_org` invoke on choose, the Globe trigger label, the active-org check mark, and the error state. The trigger keeps the current pill look.

- [ ] **Step 3: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/dropdown-menu.tsx desktop/src/components/OrgSelector.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): migrate OrgSelector to shadcn DropdownMenu"
```

---

## Task 6: ToggleGroup (view/detail toggles)

**Files:**
- Create (via CLI): `desktop/src/components/ui/toggle-group.tsx`, `desktop/src/components/ui/toggle.tsx`
- Modify: `desktop/src/panels/SoqlPanel.tsx` (TABLE/TREE), `desktop/src/panels/LogsPanel.tsx` (TREE/LIMITS/RAW)

- [ ] **Step 1: Add component**

```bash
cd desktop && pnpm dlx shadcn@latest add toggle-group --yes --overwrite
```

- [ ] **Step 2: Replace the segmented toggles**

- `SoqlPanel.tsx`: replace the TABLE/TREE button pair with a single-select `ToggleGroup` bound to the existing `view` state (`onValueChange` → setView; ignore empty value).
- `LogsPanel.tsx`: replace the TREE/LIMITS/RAW button group with a single-select `ToggleGroup` bound to the existing `tab` state.
Keep the existing state variables and their setters.

- [ ] **Step 3: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/toggle-group.tsx desktop/src/components/ui/toggle.tsx desktop/src/panels/SoqlPanel.tsx desktop/src/panels/LogsPanel.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): migrate view/detail toggles to shadcn ToggleGroup"
```

---

## Task 7: Table styling + Resizable + ScrollArea + Tooltip

**Files:**
- Create (via CLI): `desktop/src/components/ui/{table,resizable,scroll-area,tooltip}.tsx`
- Modify: `desktop/src/components/ResultTable.tsx`, `desktop/src/panels/SoqlPanel.tsx`, `desktop/src/panels/ApexPanel.tsx`, `desktop/src/panels/LogsPanel.tsx`, `desktop/src/App.tsx`

- [ ] **Step 1: Add components**

```bash
cd desktop && pnpm dlx shadcn@latest add table resizable scroll-area tooltip --yes --overwrite
```

- [ ] **Step 2: Table styling — KEEP virtualization**

In `ResultTable.tsx`, do NOT remove `@tanstack/react-table` / `@tanstack/react-virtual`. Apply the shadcn `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableCell` class names (or the components where they don't break the virtualizer's absolute-positioned rows) to the existing header + virtualized row markup so it matches shadcn's table look. The virtualized body rows keep their transform/position styles.

- [ ] **Step 3: Resizable**

In `SoqlPanel.tsx`, `ApexPanel.tsx`, `LogsPanel.tsx`, replace the direct `react-resizable-panels` `Panel`/`PanelGroup`/`PanelResizeHandle` usage with shadcn's `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` (which wrap the same lib). Preserve `defaultSize`/`minSize` and direction.

- [ ] **Step 4: ScrollArea + Tooltip**

- Wrap the result/log scroll regions in shadcn `ScrollArea` where a custom scrollbar improves the look (optional per region; keep native overflow where virtualization manages its own scroll).
- Wrap the activity-rail icon buttons and the theme-toggle button (`App.tsx`) in `Tooltip`/`TooltipTrigger`/`TooltipContent` showing the existing `title` text; add a single `TooltipProvider` high in the tree (App root).

- [ ] **Step 5: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui desktop/src/components/ResultTable.tsx desktop/src/panels desktop/src/App.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): migrate table/resizable/scroll/tooltip to shadcn"
```

---

## Task 8: ⌘K command palette

**Files:**
- Create (via CLI): `desktop/src/components/ui/{command,dialog}.tsx`
- Create: `desktop/src/components/CommandPalette.tsx`
- Modify: `desktop/src/App.tsx`

**Interfaces:**
- Consumes: `useTheme().toggle`, the `active`/`setActive` panel state in `App.tsx`, `current_org`/`list_orgs` + `set_target_org` invoke (mirror `OrgSelector`).
- Produces: `<CommandPalette open onOpenChange actions />` mounted in App; global ⌘K/Ctrl-K handler.

- [ ] **Step 1: Add components**

```bash
cd desktop && pnpm dlx shadcn@latest add command dialog --yes --overwrite
```

- [ ] **Step 2: Create `CommandPalette.tsx`**

A `CommandDialog` (open controlled by props) with `CommandInput` + `CommandList` + `CommandGroup`s:
- **Panels:** "Go to SOQL / Apex / Logs" → call `setActive(id)` (passed in via prop), then close.
- **Theme:** "Toggle light/dark" → `useTheme().toggle()`, close.
- **Orgs:** fetch `list_orgs` on first open; each org → `invoke("set_target_org", { username })`, close.
Each action closes the dialog (`onOpenChange(false)`).

- [ ] **Step 3: Wire into `App.tsx`**

Add `const [cmdOpen, setCmdOpen] = useState(false);`, a `useEffect` global keydown handler ( `(e.metaKey||e.ctrlKey) && e.key === "k"` → `e.preventDefault(); setCmdOpen(o => !o)` ), and render `<CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onSelectPanel={setActive} />`.

- [ ] **Step 4: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/command.tsx desktop/src/components/ui/dialog.tsx desktop/src/components/CommandPalette.tsx desktop/src/App.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): add ⌘K command palette"
```

---

## Task 9: Sonner toasts

**Files:**
- Create (via CLI): `desktop/src/components/ui/sonner.tsx`
- Modify: `desktop/src/App.tsx`, `desktop/src/panels/SoqlPanel.tsx`, `desktop/src/panels/ApexPanel.tsx`, `desktop/src/components/OrgSelector.tsx`

- [ ] **Step 1: Add component**

```bash
cd desktop && pnpm dlx shadcn@latest add sonner --yes --overwrite
```

- [ ] **Step 2: Mount `<Toaster />`**

Render shadcn's `<Toaster />` (from `@/components/ui/sonner`) once at the App root. It must read the current theme — pass `theme={theme}` from `useTheme()`.

- [ ] **Step 3: Replace inline run-errors with toasts**

- `SoqlPanel.tsx`: when `run_soql` rejects, call `toast.error(message)` instead of (or in addition to removing) the inline error block.
- `ApexPanel.tsx`: when `run_apex` rejects (the catch path, NOT compile/runtime outcome which is shown in RESULT), `toast.error(message)`.
- `OrgSelector.tsx`: on `list_orgs` failure, `toast.error(...)`.
Do NOT touch Monaco editor diagnostics (the SOQL/Apex squiggles stay as markers).

- [ ] **Step 4: Verify + commit**

Run: `cd desktop && npx tsc --noEmit && pnpm build`
```bash
git add desktop/src/components/ui/sonner.tsx desktop/src/App.tsx desktop/src/panels/SoqlPanel.tsx desktop/src/panels/ApexPanel.tsx desktop/src/components/OrgSelector.tsx desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(desktop): surface run errors via Sonner toasts"
```

---

## Task 10: Final verification

- [ ] **Step 1:** `cd desktop && npx tsc --noEmit` → passes.
- [ ] **Step 2:** `cd desktop && pnpm build` → passes.
- [ ] **Step 3:** Print `git log --oneline <BASE>..HEAD` — confirm the 9 feature commits landed.
- [ ] **Step 4 (reviewer, not executor):** Vite + Playwright screenshots in light AND dark across SOQL/Apex/Logs + ⌘K open — confirm no Cursor visual drift, zero console errors, virtualized table still renders.

## Self-Review notes (coverage)

Spec sections → tasks: setup→T1; token bridge + `.dark`→T2; Button/Badge→T3; Select→T4; DropdownMenu→T5; ToggleGroup→T6; Table(keep virtual)/Resizable/ScrollArea/Tooltip→T7; ⌘K→T8; Sonner→T9; verification→T10. Kept-handrolled list honored (TabStrip/RecordTree/LogView/Monaco/rail untouched). No OKLCH (hex kept). Success token added in T2, used in T3.
