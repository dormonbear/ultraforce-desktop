# Multi-tab queries (SOQL & Anonymous Apex) — Design

> Date: 2026-06-19 · Status: Approved (design) · Stack: Tauri 2 + React 19 + Tailwind v4 + Lucide
> Reference: the established Salesforce IDE plugin "SOQL Query NN" / "Anonymous Apex NN" tab bars.
> Deferred from: `2026-06-19-lang-parity-design.md` ("Out of scope … multi-tab queries").

## Goal & non-goals

**Goal.** Let the user keep multiple independent SOQL / Anonymous Apex editors open at
once, each with its own editor content, last result, and view state — like the reference plugin's
auto-numbered tab bar. A `+` adds a tab, `×` closes one, clicking switches, and the active
tab is visually marked. State is per-tab and fully isolated.

**Non-goals (v1).**
- **No Rust change.** The Tauri commands (`run_soql`, `run_apex`, `set_target_org`, …)
  are stateless per-call and the target org is global. Tabs are a pure frontend concern.
- **No persistence across app restarts.** In-memory only (see *Persistence decision*).
- **No tab reordering / drag-and-drop, no split view, no detach-to-window.** YAGNI.
- **No new dependencies.** Reuse existing tokens, Lucide icons, Tailwind classes.
- The Logs panel is **not** tabbed (it is a list+detail browser, not an editor surface).
- The global `OrgSelector` is untouched — switching tabs never re-runs anything; running
  inside any tab still uses the single global target org.

## Component architecture

Today each panel owns its own single query/result state internally
(`SoqlPanel` holds `query/result/error/running/view`; `ApexPanel` holds
`src/outcome/error/running/traceOpen`). We **lift that state up** into a per-tool
container that owns an array of tab models, and turn the panels into controlled,
per-tab **views**.

```
App.tsx
 ├─ <SoqlTabs/>                       container: owns tabs[] + activeId (state)
 │    ├─ <TabStrip/>                  generic: renders tab buttons + add (+) + close (×)
 │    └─ <SoqlView tab onChange/>     ex-SoqlPanel, now controlled by one tab model
 └─ <ApexTabs/>                       container: owns tabs[] + activeId (state)
      ├─ <TabStrip/>                  same generic component
      └─ <ApexView tab onChange/>     ex-ApexPanel, now controlled by one tab model
```

**State ownership (the locked decision).**
- `SoqlTabs` / `ApexTabs` are the **single source of truth**: each owns
  `tabs: SoqlTab[] | ApexTab[]` and `activeId: string`.
- A shared **`useTabs<T>(factory)` hook** encapsulates add / close / setActive / patch
  (rename is folded into patch). Both containers use it; the only difference is the
  per-tool tab factory (initial content + title prefix).
- `SoqlView` / `ApexView` are **controlled**: they receive `tab` (the active model) and
  `onPatch(partial)` and render exactly what the old panel rendered, but read/write
  through the model instead of local `useState`. Mounting **all tabs would be wasteful**;
  we render **only the active tab's view** and key it by `tab.id` so React fully
  remounts on switch — giving each tab a clean Monaco instance and isolated DOM. Editor
  content + result are preserved because they live in the model, not the view.
- `TabStrip` is **stateless / presentational**: it takes `tabs`, `activeId`,
  `onSelect`, `onClose`, `onAdd` and renders. No business logic.

This keeps the refactor surgical: the JSX bodies of `SoqlPanel`/`ApexPanel` move almost
verbatim into `SoqlView`/`ApexView`; the only change is `useState(x)` →
`tab.x` / `onPatch({ x })`.

## Tab model

Generic over the per-tool payload, with the shared identity fields lifted out:

```ts
// src/tabs/types.ts
export interface TabBase {
  id: string;        // crypto.randomUUID()
  title: string;     // "SOQL Query 1", "Anonymous Apex 2", …
}

export interface SoqlTab extends TabBase {
  query: string;
  result: SoqlResultDto | null;
  error: string | null;
  view: "table" | "tree";
  // `running` stays local to the view (transient, per-invoke) — not persisted in the model.
}

export interface ApexTab extends TabBase {
  src: string;
  outcome: ApexOutcomeDto | null;
  error: string | null;
  traceOpen: boolean;
}
```

`running` is intentionally **not** in the model: it is a transient flag tied to an
in-flight `invoke` and is fine to reset on tab switch (a remount cancels nothing on the
Rust side, but the UI simply shows the not-running state; the result still lands in the
model via the resolved promise only if the view is still mounted — acceptable for v1,
documented below).

> v1 simplification: if the user switches away mid-run and back, the spinner is gone but
> a completed result is *not* captured (the view that fired the `invoke` was unmounted).
> This is acceptable for v1 and called out in Self-review. A future version can hoist the
> async call into the container so results land regardless of which tab is visible.

## Add / close / rename / switch behavior

- **Add (`+`).** Appends a fresh tab from the tool factory, with an auto-numbered title.
  Numbering uses a **monotonic counter per container** (not `tabs.length + 1`) so closing
  tab 2 then adding does not produce a duplicate "… 2". Newly added tab becomes active.
- **Close (`×`).** Removes the tab. If it was active, activate the **neighbor** (previous
  if exists, else next). **Minimum one tab:** closing the *last* tab is a **no-op**
  (the `×` is hidden/disabled when `tabs.length === 1`).
- **Switch.** Click a tab → `setActive(id)`. Pure state change; the active view remounts
  (keyed by id), restoring that tab's editor content + result + view state.
- **Rename.** Not exposed as UI in v1 (the reference plugin's auto-numbered titles are enough). The model
  supports it via `onPatch({ title })`, so a double-click-to-rename can be added later
  with zero model change. Documented as future, not built.

## Persistence decision (in-memory v1)

**Decision: in-memory only.** Tab state lives in React state and is lost on app restart.

Rationale (YAGNI): persistence adds serialization, a storage key, schema-version
migration, and "restore vs fresh" UX — none of which the parity goal requires, and
Monaco/result DTOs are heavy to serialize. **Future option (noted, not built):** persist
`tabs` (minus `result`/`outcome`, which are re-derivable by re-running) to `localStorage`
under a versioned key and rehydrate on mount. The model is already a plain serializable
object, so this is additive.

## Styling

Reuse existing tokens only — **no new tokens** (per feature parity "Unit 4 — Visual
fidelity"). The tab strip mirrors the **activity-rail active treatment**: an
**accent indicator** on the active tab plus accent text; inactive tabs are `text-dim`
with `hover:text-text`.

- Strip: `flex h-9 items-center gap-px border-b border-hair px-2`, `bg-surface`.
- Tab button: `text-[12px] px-3 h-7 rounded-[3px] cursor-pointer` + `focus-accent`.
  - Active: `text-accent` + a 2px accent underline
    (`absolute inset-x-1 -bottom-px h-0.5 rounded bg-accent`) echoing the rail's
    left indicator. `aria-selected="true"`.
  - Inactive: `text-text-dim hover:text-text`.
- Close `×` (Lucide `X`, size 12): appears on hover/active, `text-text-faint
  hover:text-red`, `aria-label="Close {title}"`, `cursor-pointer`; **hidden when
  `tabs.length === 1`**. `stopPropagation` so closing doesn't also switch.
- Add `+` (Lucide `Plus`, size 14): trailing button, `text-text-dim hover:text-accent`,
  `aria-label="New tab"`, `focus-accent`, `cursor-pointer`.
- Transitions 150ms (`transition-colors`); respect `prefers-reduced-motion` (already
  global). Tabular numerals on the numbered titles via `tnum`.

## Wrapping the existing panels (minimal refactor)

1. **`SoqlView`** = current `SoqlPanel` body. Replace its five `useState` with reads from
   `tab` and writes via `onPatch`. `running` stays a local `useState` (transient). `run`
   writes `result`/`error` through `onPatch`. The `PanelGroup` layout, `SoqlEditor`,
   `ResultTable`, `RecordTree`, status line — all unchanged.
2. **`ApexView`** = current `ApexPanel` body. Same transform: `src`/`outcome`/`error`/
   `traceOpen` come from `tab`/`onPatch`; `running` local. Monaco `beforeMount`/`onMount`,
   `RunButton`, `LogView`, status chips — unchanged.
3. **`SoqlTabs` / `ApexTabs`** wrap `<TabStrip/>` + the active `<*View/>` (keyed by id).
4. **`App.tsx`** renders `<SoqlTabs/>` / `<ApexTabs/>` instead of `<SoqlPanel/>` /
   `<ApexPanel/>`. Rail, top bar, accent strip, Logs routing unchanged.

Behavior of a single tab must be **byte-for-byte identical** to today's single panel.

## Testing

- **Primary gate:** `cd desktop && pnpm build` (tsc + vite) green after each task.
  No display in this env, so do **not** rely on `pnpm tauri dev`.
- **Logic seam:** the `useTabs` hook (add/close/switch/min-one/neighbor-activation/
  monotonic numbering) is pure and unit-testable with React Testing Library + Vitest if a
  harness exists; otherwise covered by types + manual reasoning and called out in
  Self-review. (Repo currently leans on `pnpm build` as the gate — match that.)
- **Optional Playwright** snapshot of the tab strip deferred (no display in CI here),
  consistent with the feature parity plan's stance.

## Accessibility

- `TabStrip` root `role="tablist"`, `aria-label="SOQL tabs"` / `"Apex tabs"`.
- Each tab button `role="tab"`, `aria-selected`, and `tabIndex` roving (active = 0,
  others = -1). The view container gets `role="tabpanel"` with `aria-labelledby` the
  active tab's id.
- **Keyboard (optional but specified):** `ArrowLeft`/`ArrowRight` move selection within
  the strip; `Enter`/`Space` activate; `Delete`/`Backspace` on a focused tab closes it
  (no-op when one tab). All controls keyboard-focusable with visible accent focus rings
  (`focus-accent`). Icon-only `+` / `×` carry `aria-label`. Color-not-only: the active
  tab is marked by both accent color **and** the underline indicator + `aria-selected`.
