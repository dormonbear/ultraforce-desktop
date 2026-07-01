# Apex Log Visualizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four visualizations to the Apex debug-log analysis UI — hotspot share bars, a time-breakdown strip, SOQL query-family bars, and a canvas flame-chart timeline.

**Architecture:** Pure, node-testable data modules in `desktop/src/panels/*.ts` (same pattern as `insights.ts`/`limitStats.ts`/`queryStats.ts`) feed React views in `desktop/src/panels/`. The flame chart is a hand-rolled `<canvas>` — no chart library. One Rust prerequisite exposes each tree node's start offset.

**Tech Stack:** React + TypeScript, Tailwind, HTML canvas, vitest (`vitest run`), Rust (Tauri DTO layer), Playwright (smoke e2e).

## Global Constraints

- No new npm/cargo dependencies. CSS bars + hand-rolled canvas only.
- Test runner: `npx vitest run <file>` from `desktop/`. Lint: `npm run lint` (oxlint).
- Pure data modules go in `desktop/src/panels/`, are React-free, and have a colocated `*.test.ts`.
- New React views are separate files under `desktop/src/panels/`, not piled into `LogsPanel.tsx` (already 473 lines / CRITICAL complexity).
- Money/DB-time numbers formatted via existing `formatMs` (keep in `LogsPanel.tsx`; import if needed or duplicate the 2-line helper — do not create a shared util just for it unless a third consumer appears).
- Commit after every task with a conventional-commit message.
- Rust commands run from repo root: `cargo test -p sf-desktop` (the Tauri crate; confirm crate name via `cargo test` if unsure).

---

### Task 1: Expose `start_ns` on the execution-tree DTO (Rust)

The flame chart positions rects on an elapsed-time axis. `ExecNode.entry.nanos` (elapsed ns from log start) exists in the parser but is not mapped to the frontend DTO.

**Files:**
- Modify: `desktop/src-tauri/src/dto.rs` (`ExecNodeDto` struct ~line 557, `map_node` ~line 669, tree test ~line 768)

**Interfaces:**
- Produces: `ExecNodeDto.start_ns: u64` — absolute start offset in ns.

- [ ] **Step 1: Write the failing test.** In `dto.rs`, find the existing tree-mapping test (around line 768 using `build_tree`). Add an assertion that the mapped root DTO carries `start_ns` equal to the source node's `entry.nanos`:

```rust
#[test]
fn maps_start_ns_from_entry_nanos() {
    let text = "16:55:57.42 (42826462)|METHOD_ENTRY|[1]|Foo.bar()\n\
                16:55:57.43 (52826462)|METHOD_EXIT|[1]|Foo.bar()";
    let unit = ParsedLog::parse(text).units[0].clone();
    let roots = build_tree(&unit);
    let dto = map_node(&roots[0]);
    assert_eq!(dto.start_ns, 42_826_462);
}
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cargo test -p sf-desktop maps_start_ns_from_entry_nanos`
Expected: FAIL — no field `start_ns` on `ExecNodeDto`.

- [ ] **Step 3: Add the field and mapping.** In the `ExecNodeDto` struct add:

```rust
    /// Absolute start offset in ns from log start (from `entry.nanos`).
    pub start_ns: u64,
```

In `map_node`, add to the constructed struct:

```rust
        start_ns: node.entry.nanos,
```

- [ ] **Step 4: Run test, verify it passes.**

Run: `cargo test -p sf-desktop maps_start_ns_from_entry_nanos`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add desktop/src-tauri/src/dto.rs
git commit -m "feat(log): expose start_ns on ExecNodeDto for flame chart"
```

---

### Task 2: Mirror `start_ns` in the frontend type

**Files:**
- Modify: `desktop/src/types.ts` (`ExecNodeDto` interface ~line 94)

**Interfaces:**
- Produces: `ExecNodeDto.start_ns: number` (TS).

- [ ] **Step 1: Add the field.** In the `ExecNodeDto` interface, alongside `dur_ns`/`self_ns`:

```ts
  /** Absolute start offset in ns from log start. */
  start_ns: number;
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit -p desktop/tsconfig.json` (or `cd desktop && npx vue-tsc`/`tsc` per project). Expected: no new errors.

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/types.ts
git commit -m "feat(log): add start_ns to frontend ExecNodeDto type"
```

---

### Task 3: Hotspot share bars

Add a self-time share bar behind the Method cell in the existing `HotspotsView`. Trivial visual change — no new module, verified by lint + manual view.

**Files:**
- Modify: `desktop/src/panels/LogsPanel.tsx` (`HotspotsView` ~lines 328-404)

- [ ] **Step 1: Compute the max self-time once** after `const rows = ...sort(...)` in `HotspotsView`:

```tsx
  const maxSelf = rows.length > 0 ? rows[0].self_ns : 0; // rows are sorted desc by self_ns
```

- [ ] **Step 2: Render the bar** inside the Method `<td>` — wrap the existing content so the bar sits behind it. Replace the Method `<td>`'s className/content with:

```tsx
            <td
              className="relative max-w-0 truncate py-0.5 pr-2 text-foreground"
              title={h.signature}
            >
              <span
                className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-primary/10"
                style={{ width: `${maxSelf > 0 ? (h.self_ns / maxSelf) * 100 : 0}%` }}
                aria-hidden
              />
              {ref ? (
                <button
                  type="button"
                  onClick={() => onSource(ref)}
                  title="Jump to source"
                  className="cursor-pointer truncate text-left hover:text-primary hover:underline"
                >
                  {h.signature}
                </button>
              ) : (
                h.signature
              )}
            </td>
```

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Expected: no new errors. Manually: open a log → Hotspots tab → bars scale with Self time.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/LogsPanel.tsx
git commit -m "feat(log): self-time share bars in hotspots view"
```

---

### Task 4: `timeBreakdown` data module

**Files:**
- Create: `desktop/src/panels/timeBreakdown.ts`
- Create: `desktop/src/panels/timeBreakdown.test.ts`

**Interfaces:**
- Consumes: `UnitDto`, `ExecNodeDto` from `../types`.
- Produces: `type TimeCategory`, `interface TimeSlice { category; ns; pct }`, `timeBreakdown(units: UnitDto[]): TimeSlice[]`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { timeBreakdown } from "./timeBreakdown";
import type { UnitDto, ExecNodeDto } from "../types";

function node(label: string, self_ns: number, children: ExecNodeDto[] = []): ExecNodeDto {
  return { label, detail: "", start_ns: 0, dur_ns: self_ns, self_ns, children, source: null };
}
function unit(tree: ExecNodeDto[]): UnitDto {
  return { tree, hotspots: [], statements: [], limits: [] } as unknown as UnitDto;
}

describe("timeBreakdown", () => {
  it("buckets self-time by event category and computes pct", () => {
    const u = unit([
      node("METHOD_ENTRY", 60, [node("SOQL_EXECUTE_BEGIN", 30), node("DML_BEGIN", 10)]),
    ]);
    const slices = timeBreakdown([u]);
    const byCat = Object.fromEntries(slices.map((s) => [s.category, s.ns]));
    expect(byCat.apex).toBe(60);
    expect(byCat.soql).toBe(30);
    expect(byCat.dml).toBe(10);
    const apex = slices.find((s) => s.category === "apex")!;
    expect(Math.round(apex.pct)).toBe(60);
  });

  it("returns empty for no time", () => {
    expect(timeBreakdown([unit([])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd desktop && npx vitest run src/panels/timeBreakdown.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.**

```ts
import type { UnitDto, ExecNodeDto } from "../types";

export type TimeCategory = "apex" | "soql" | "dml" | "callout" | "other";

export interface TimeSlice {
  category: TimeCategory;
  /** Summed self-time in ns. */
  ns: number;
  /** Share of total self-time, 0-100. */
  pct: number;
}

function categoryOf(kind: string): TimeCategory {
  if (/SOQL_EXECUTE|SOSL_EXECUTE/.test(kind)) return "soql";
  if (/DML_/.test(kind)) return "dml";
  if (/CALLOUT_/.test(kind)) return "callout";
  if (/METHOD_|CONSTRUCTOR_|CODE_UNIT_|EXECUTION_/.test(kind)) return "apex";
  return "other";
}

/** Split total self-time across categories (apex vs DB vs callout vs other),
 * sorted descending, zero slices dropped. Self-time avoids double counting
 * because a parent's children are excluded from its own self_ns. */
export function timeBreakdown(units: UnitDto[]): TimeSlice[] {
  const sums: Record<TimeCategory, number> = {
    apex: 0, soql: 0, dml: 0, callout: 0, other: 0,
  };
  const walk = (n: ExecNodeDto) => {
    sums[categoryOf(n.label)] += n.self_ns ?? 0;
    for (const c of n.children) walk(c);
  };
  for (const u of units) for (const n of u.tree) walk(n);

  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  return (Object.keys(sums) as TimeCategory[])
    .map((category) => ({
      category,
      ns: sums[category],
      pct: total > 0 ? (sums[category] / total) * 100 : 0,
    }))
    .filter((s) => s.ns > 0)
    .sort((a, b) => b.ns - a.ns);
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd desktop && npx vitest run src/panels/timeBreakdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/panels/timeBreakdown.ts desktop/src/panels/timeBreakdown.test.ts
git commit -m "feat(log): timeBreakdown data module"
```

---

### Task 5: `TimeBreakdownBar` component + wire into analysis panel

**Files:**
- Create: `desktop/src/panels/TimeBreakdownBar.tsx`
- Modify: `desktop/src/panels/LogsPanel.tsx` (render the strip above the tab content, in the non-raw branch)

**Interfaces:**
- Consumes: `timeBreakdown`, `TimeCategory` from `./timeBreakdown`; `UnitDto` from `../types`.
- Produces: `TimeBreakdownBar({ units }: { units: UnitDto[] })`.

- [ ] **Step 1: Implement the component.**

```tsx
import type { UnitDto } from "../types";
import { timeBreakdown, type TimeCategory } from "./timeBreakdown";

const CAT_COLOR: Record<TimeCategory, string> = {
  apex: "bg-slate-500",
  soql: "bg-success",
  dml: "bg-emerald-600",
  callout: "bg-amber-500",
  other: "bg-border",
};

const CAT_LABEL: Record<TimeCategory, string> = {
  apex: "Apex", soql: "SOQL", dml: "DML", callout: "Callout", other: "Other",
};

function ms(ns: number): string {
  return `${(ns / 1_000_000).toFixed(ns < 1_000_000 ? 3 : 2)} ms`;
}

/** One-row stacked bar showing where execution time went, with a legend. */
export function TimeBreakdownBar({ units }: { units: UnitDto[] }) {
  const slices = timeBreakdown(units);
  if (slices.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 pb-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-border">
        {slices.map((s) => (
          <span
            key={s.category}
            className={`h-full ${CAT_COLOR[s.category]}`}
            style={{ width: `${s.pct}%` }}
            title={`${CAT_LABEL[s.category]} · ${ms(s.ns)} · ${s.pct.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
        {slices.map((s) => (
          <span key={s.category} className="inline-flex items-center gap-1">
            <span className={`inline-block size-2 rounded-sm ${CAT_COLOR[s.category]}`} />
            {CAT_LABEL[s.category]} <span className="tnum text-foreground">{ms(s.ns)}</span>
            <span className="tnum">{s.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it in.** In `LogsPanel.tsx`, import at top:

```tsx
import { TimeBreakdownBar } from "./TimeBreakdownBar";
```

In the non-raw branch (the `<ScrollArea>` block that wraps `tab === "tree" ? ...`), render the strip once above the `<div className="p-3">` content, so it shows for every analysis tab. Immediately inside `<div className="p-3">` add as the first child:

```tsx
                  <TimeBreakdownBar units={view.units} />
```

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: open a log → any analysis tab → stacked strip + legend appear and sum to ~100%.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/TimeBreakdownBar.tsx desktop/src/panels/LogsPanel.tsx
git commit -m "feat(log): time-breakdown stacked bar in analysis panel"
```

---

### Task 6: SOQL fingerprinting + query-family grouping

**Files:**
- Modify: `desktop/src/panels/queryStats.ts` (add `soqlFingerprint`, `groupByFingerprint`, `QueryFamily`)
- Modify: `desktop/src/panels/queryStats.test.ts` (add cases; create the file if it does not exist)

**Interfaces:**
- Consumes: existing `StmtLike` from `./queryStats`.
- Produces: `soqlFingerprint(text: string): string`, `interface QueryFamily { fingerprint; kind; sample; count; rows; totalNs }`, `groupByFingerprint(stmts: StmtLike[]): QueryFamily[]`.

- [ ] **Step 1: Write the failing test** (append to `queryStats.test.ts`):

```ts
import { soqlFingerprint, groupByFingerprint } from "./queryStats";

describe("soqlFingerprint", () => {
  it("strips bind literals so loop-bound queries share a fingerprint", () => {
    const a = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001aaa'");
    const b = soqlFingerprint("SELECT Id FROM Account WHERE Id = '001bbb'");
    expect(a).toBe(b);
  });
  it("collapses IN lists and numbers", () => {
    expect(soqlFingerprint("SELECT Id FROM A WHERE X IN ('a','b',3) LIMIT 50")).toBe(
      "SELECT ID FROM A WHERE X IN (?) LIMIT ?",
    );
  });
});

describe("groupByFingerprint", () => {
  it("groups by fingerprint and ranks by total time", () => {
    const fams = groupByFingerprint([
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '1'", rows: 1, dur_ns: 100 },
      { kind: "soql", text: "SELECT Id FROM Account WHERE Id = '2'", rows: 1, dur_ns: 200 },
      { kind: "dml", text: "insert Account", rows: 1, dur_ns: 50 },
    ]);
    expect(fams).toHaveLength(2);
    expect(fams[0].count).toBe(2);
    expect(fams[0].totalNs).toBe(300);
    expect(fams[0].rows).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd desktop && npx vitest run src/panels/queryStats.test.ts`
Expected: FAIL — `soqlFingerprint`/`groupByFingerprint` not exported.

- [ ] **Step 3: Implement** (append to `queryStats.ts`):

```ts
/** Normalize a SOQL/DML statement so runs differing only by bound values group
 * together — the N+1 / SOQL-in-loop signal. Strips string literals, collapses
 * IN (...) lists, replaces bare numbers, normalizes whitespace and case. */
export function soqlFingerprint(text: string): string {
  return text
    .replace(/'(?:[^'\\]|\\.)*'/g, "?")
    .replace(/\bIN\s*\([^)]*\)/gi, "IN (?)")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export interface QueryFamily {
  fingerprint: string;
  kind: string;
  /** One representative original statement text. */
  sample: string;
  count: number;
  rows: number;
  totalNs: number;
}

/** Group statements by fingerprint, ranked by total DB time then run count. */
export function groupByFingerprint(stmts: StmtLike[]): QueryFamily[] {
  const fams = new Map<string, QueryFamily>();
  for (const s of stmts) {
    const fp = `${s.kind} ${soqlFingerprint(s.text)}`;
    const ns = s.dur_ns ?? 0;
    const f = fams.get(fp);
    if (f) {
      f.count += 1;
      f.rows += s.rows;
      f.totalNs += ns;
    } else {
      fams.set(fp, { fingerprint: fp, kind: s.kind, sample: s.text, count: 1, rows: s.rows, totalNs: ns });
    }
  }
  return [...fams.values()].sort((a, b) => b.totalNs - a.totalNs || b.count - a.count);
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd desktop && npx vitest run src/panels/queryStats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/panels/queryStats.ts desktop/src/panels/queryStats.test.ts
git commit -m "feat(log): soqlFingerprint + query-family grouping"
```

---

### Task 7: Query-family bars in `QueriesView`

Switch `QueriesView` from exact-text `groupStatements` to `groupByFingerprint` and add a total-time share bar. Keep the SOQL/DML summary line.

**Files:**
- Modify: `desktop/src/panels/LogsPanel.tsx` (`QueriesView` ~lines 430-489; import update)

- [ ] **Step 1: Update the import** at the top of `LogsPanel.tsx` where `groupStatements`/`totalNs` are imported from `./queryStats`, add `groupByFingerprint`:

```tsx
import { groupByFingerprint, totalNs } from "./queryStats";
```

(Remove `groupStatements` from the import if it becomes unused; leave it if other code uses it.)

- [ ] **Step 2: Replace the rows table body.** In `QueriesView`, replace `const rows = groupStatements(all);` with:

```tsx
  const families = groupByFingerprint(all);
  const maxNs = families.length > 0 ? families[0].totalNs : 0;
```

Then replace the `<tbody>` rows `.map` with a fingerprint-family row that carries a share bar:

```tsx
        <tbody>
          {families.map((g, i) => (
            <tr
              key={i}
              className={`border-t border-border/50 ${g.count > 1 ? "text-destructive" : "text-text-dim"}`}
              title={g.count > 1 ? "run more than once — possible N+1 / loop" : g.sample}
            >
              <td className="relative max-w-0 truncate py-0.5 pr-2 text-foreground" title={g.sample}>
                <span
                  className="absolute inset-y-0 left-0 -z-10 rounded-sm bg-success/10"
                  style={{ width: `${maxNs > 0 ? (g.totalNs / maxNs) * 100 : 0}%` }}
                  aria-hidden
                />
                <span className="text-text-dim/70">{g.kind === "dml" ? "DML " : "SOQL "}</span>
                {g.sample}
              </td>
              <td className="tnum py-0.5 text-right">{g.totalNs > 0 ? formatMs(g.totalNs) : "—"}</td>
              <td className="tnum py-0.5 text-right">{g.count}</td>
              <td className="tnum py-0.5 text-right">{g.rows}</td>
            </tr>
          ))}
        </tbody>
```

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: a log with a query run in a loop shows ONE family row with `×N` and a wide bar.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/LogsPanel.tsx
git commit -m "feat(log): query-family bars via fingerprinting in queries view"
```

---

### Task 8: `flame.ts` — layout + geometry (pure)

**Files:**
- Create: `desktop/src/panels/flame.ts`
- Create: `desktop/src/panels/flame.test.ts`

**Interfaces:**
- Consumes: `ExecNodeDto` from `../types`.
- Produces: `interface FlameRect { x; w; depth; label; kind; source }`; `flameLayout(roots): FlameRect[]`; `flameSpan(rects): {start;end}`; `flameDepth(rects): number`; `timeToX(t,vs,ve,w): number`; `xToTime(x,vs,ve,w): number`; `hitTest(rects,px,py,vs,ve,w,rowH): FlameRect|null`; `minimapSkyline(rects,start,end,n): number[]`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { flameLayout, flameSpan, flameDepth, timeToX, xToTime, hitTest, minimapSkyline } from "./flame";
import type { ExecNodeDto } from "../types";

function n(label: string, start: number, dur: number, children: ExecNodeDto[] = []): ExecNodeDto {
  return { label, detail: `${label}-d`, start_ns: start, dur_ns: dur, self_ns: dur, children, source: null };
}

describe("flameLayout", () => {
  it("flattens tree with depth and absolute x", () => {
    const rects = flameLayout([n("METHOD_ENTRY", 0, 100, [n("SOQL_EXECUTE_BEGIN", 10, 30)])]);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 0, w: 100, depth: 0, kind: "METHOD_ENTRY", label: "METHOD_ENTRY-d" });
    expect(rects[1]).toMatchObject({ x: 10, w: 30, depth: 1 });
  });
  it("span and depth", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 10, 30)])]);
    expect(flameSpan(rects)).toEqual({ start: 0, end: 100 });
    expect(flameDepth(rects)).toBe(1);
  });
});

describe("geometry", () => {
  it("timeToX / xToTime round-trip", () => {
    expect(timeToX(50, 0, 100, 200)).toBe(100);
    expect(xToTime(100, 0, 100, 200)).toBe(50);
  });
  it("hitTest finds the rect at a point", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 10, 30)])]);
    const hit = hitTest(rects, 40, 25, 0, 100, 100, 20); // x=40ns depth=1
    expect(hit?.kind).toBe("B");
  });
  it("minimapSkyline reports max depth per bucket", () => {
    const rects = flameLayout([n("A", 0, 100, [n("B", 0, 50)])]);
    const sky = minimapSkyline(rects, 0, 100, 2);
    expect(sky[0]).toBe(2); // depths 0 and 1 present in first half
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd desktop && npx vitest run src/panels/flame.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.**

```ts
import type { ExecNodeDto } from "../types";

export interface FlameRect {
  /** Absolute start offset in ns. */
  x: number;
  /** Duration in ns (>= 0; 0 for leaf/unclosed, rendered at 1px min). */
  w: number;
  depth: number;
  /** Display text. */
  label: string;
  /** Event-kind name, used for color. */
  kind: string;
  source: ExecNodeDto["source"];
}

/** Flatten the execution tree into positioned rects. */
export function flameLayout(roots: ExecNodeDto[]): FlameRect[] {
  const rects: FlameRect[] = [];
  const walk = (node: ExecNodeDto, depth: number) => {
    rects.push({
      x: node.start_ns,
      w: node.dur_ns ?? 0,
      depth,
      label: node.detail || node.label,
      kind: node.label,
      source: node.source,
    });
    for (const c of node.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return rects;
}

export function flameSpan(rects: FlameRect[]): { start: number; end: number } {
  if (rects.length === 0) return { start: 0, end: 0 };
  let start = Infinity;
  let end = 0;
  for (const r of rects) {
    if (r.x < start) start = r.x;
    if (r.x + r.w > end) end = r.x + r.w;
  }
  return { start, end };
}

export function flameDepth(rects: FlameRect[]): number {
  return rects.reduce((m, r) => Math.max(m, r.depth), 0);
}

export function timeToX(t: number, viewStart: number, viewEnd: number, width: number): number {
  if (viewEnd <= viewStart) return 0;
  return ((t - viewStart) / (viewEnd - viewStart)) * width;
}

export function xToTime(x: number, viewStart: number, viewEnd: number, width: number): number {
  if (width <= 0) return viewStart;
  return viewStart + (x / width) * (viewEnd - viewStart);
}

/** Topmost rect at canvas point (px, py) for the current viewport + row height. */
export function hitTest(
  rects: FlameRect[],
  px: number,
  py: number,
  viewStart: number,
  viewEnd: number,
  width: number,
  rowH: number,
): FlameRect | null {
  const depth = Math.floor(py / rowH);
  for (const r of rects) {
    if (r.depth !== depth) continue;
    const x0 = timeToX(r.x, viewStart, viewEnd, width);
    const x1 = timeToX(r.x + r.w, viewStart, viewEnd, width);
    if (px >= x0 && px <= Math.max(x1, x0 + 1)) return r;
  }
  return null;
}

/** Skyline density for the minimap: max depth reached in each of `n` buckets. */
export function minimapSkyline(rects: FlameRect[], start: number, end: number, n: number): number[] {
  const buckets = new Array(n).fill(0);
  if (end <= start) return buckets;
  for (const r of rects) {
    const b = Math.min(n - 1, Math.floor(((r.x - start) / (end - start)) * n));
    if (r.depth + 1 > buckets[b]) buckets[b] = r.depth + 1;
  }
  return buckets;
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd desktop && npx vitest run src/panels/flame.test.ts`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/panels/flame.ts desktop/src/panels/flame.test.ts
git commit -m "feat(log): flame layout + geometry helpers"
```

---

### Task 9: `flameColor` helper

**Files:**
- Create: `desktop/src/panels/flameColor.ts`
- Create: `desktop/src/panels/flameColor.test.ts`

**Interfaces:**
- Produces: `flameColor(kind: string): string` (hex).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { flameColor } from "./flameColor";

describe("flameColor", () => {
  it("colors by event category", () => {
    expect(flameColor("EXCEPTION_THROWN")).toBe("#ef4444");
    expect(flameColor("SOQL_EXECUTE_BEGIN")).toBe("#22c55e");
    expect(flameColor("DML_BEGIN")).toBe("#22c55e");
    expect(flameColor("METHOD_ENTRY")).toBe("#64748b");
    expect(flameColor("SOMETHING_ELSE")).toBe("#475569");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd desktop && npx vitest run src/panels/flameColor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
/** Canvas fill (hex) for a flame rect by event-kind name. Mirrors the category
 * coloring of LogView's eventColor as concrete hex for canvas drawing. */
export function flameColor(kind: string): string {
  if (/FATAL_ERROR|EXCEPTION_THROWN/.test(kind)) return "#ef4444"; // red
  if (kind === "USER_DEBUG") return "#3b82f6"; // blue
  if (/SOQL_EXECUTE|SOSL_EXECUTE|DML_|CALLOUT_/.test(kind)) return "#22c55e"; // green
  if (/CONSTRUCTOR_/.test(kind)) return "#a855f7"; // purple
  if (/METHOD_|CODE_UNIT_|EXECUTION_/.test(kind)) return "#64748b"; // slate
  return "#475569"; // dim
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd desktop && npx vitest run src/panels/flameColor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit.**

```bash
git add desktop/src/panels/flameColor.ts desktop/src/panels/flameColor.test.ts
git commit -m "feat(log): flameColor helper"
```

---

### Task 10: `TimelineView` base canvas render + new "timeline" tab

Render static flame rects on a canvas; no interaction yet. Add the tab so it is reachable.

**Files:**
- Create: `desktop/src/panels/TimelineView.tsx`
- Modify: `desktop/src/panels/LogsPanel.tsx` (`DetailTab` union ~line 74; tab button array ~line 857; render switch; treat "timeline" like "raw" for full-height layout)

**Interfaces:**
- Consumes: `flameLayout`, `flameSpan`, `flameDepth`, `timeToX` from `./flame`; `flameColor` from `./flameColor`; `UnitDto`, `SourceRef` from `../types`/`./sourceRef`.
- Produces: `TimelineView({ units, onSource }: { units: UnitDto[]; onSource: (r: SourceRef) => void })`.

- [ ] **Step 1: Implement the base component** (viewport state + draw effect, no handlers yet):

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { UnitDto } from "../types";
import type { SourceRef } from "./sourceRef";
import { flameLayout, flameSpan, flameDepth, timeToX, type FlameRect } from "./flame";
import { flameColor } from "./flameColor";

const ROW_H = 18;

export function TimelineView({
  units,
  onSource,
}: {
  units: UnitDto[];
  onSource: (r: SourceRef) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rects = useMemo(() => flameLayout(units.flatMap((u) => u.tree)), [units]);
  const span = useMemo(() => flameSpan(rects), [rects]);
  const maxDepth = useMemo(() => flameDepth(rects), [rects]);

  // Viewport in ns; starts at the full span.
  const [view, setView] = useState<{ start: number; end: number }>(span);
  useEffect(() => setView(span), [span]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = (maxDepth + 1) * ROW_H;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textBaseline = "middle";

    for (const r of rects) {
      const x0 = timeToX(r.x, view.start, view.end, cssW);
      const x1 = timeToX(r.x + r.w, view.start, view.end, cssW);
      const w = Math.max(1, x1 - x0);
      if (x0 > cssW || x1 < 0 || w < 1) continue; // cull off-screen / sub-pixel
      const y = r.depth * ROW_H;
      ctx.fillStyle = flameColor(r.kind);
      ctx.fillRect(x0, y, w, ROW_H - 1);
      if (w > 30) {
        ctx.fillStyle = "#0b0f1a";
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, y, w - 4, ROW_H - 1);
        ctx.clip();
        ctx.fillText(r.label, x0 + 3, y + ROW_H / 2);
        ctx.restore();
      }
    }
  }, [rects, view, maxDepth]);

  if (rects.length === 0) {
    return (
      <div className="py-4 text-center text-[13px] text-muted-foreground">
        No execution tree
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card">
        <canvas ref={canvasRef} className="block w-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the tab.** In `LogsPanel.tsx`:
  - Add `| "timeline"` to the `DetailTab` union.
  - Add `"timeline"` to the tab button array (after `"tree"`).
  - Import: `import { TimelineView } from "./TimelineView";`
  - In the render, treat `timeline` like `raw` for full-height (outside the `<ScrollArea>`/`p-3` padded branch). Change the raw guard from `tab === "raw" ?` to render a full-height container for either, e.g.:

```tsx
              {tab === "raw" || tab === "timeline" ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
                  {tab === "raw" ? (
                    <LogView
                      raw={view.raw}
                      resolveSource={(line) =>
                        invoke<SourceRef | null>("source_at_line", { body: view.raw, line })
                      }
                      onSource={setSourceRef}
                    />
                  ) : (
                    <TimelineView units={view.units} onSource={setSourceRef} />
                  )}
                </div>
              ) : (
```

(Keep the rest of the non-raw branch unchanged.)

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: open a log → Timeline tab → colored flame rects render, nested by depth.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx desktop/src/panels/LogsPanel.tsx
git commit -m "feat(log): flame-chart timeline tab (base render)"
```

---

### Task 11: Zoom + pan

Add wheel-zoom (centered on cursor), drag-to-pan, and a reset. Uses `xToTime`.

**Files:**
- Modify: `desktop/src/panels/TimelineView.tsx`

- [ ] **Step 1: Add handlers.** Import `xToTime` from `./flame`. Add inside `TimelineView`, before the return:

```tsx
  const drag = useRef<{ x: number; start: number; end: number } | null>(null);

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = xToTime(px, view.start, view.end, rect.width);
    const factor = e.deltaY < 0 ? 0.8 : 1.25; // in / out
    const newSpan = (view.end - view.start) * factor;
    const ratio = (t - view.start) / (view.end - view.start);
    let start = t - ratio * newSpan;
    let end = start + newSpan;
    // clamp to full span
    if (start < span.start) { start = span.start; end = start + newSpan; }
    if (end > span.end) { end = span.end; start = Math.max(span.start, end - newSpan); }
    setView({ start, end });
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.shiftKey) return; // reserved for measure (later task)
    drag.current = { x: e.clientX, start: view.start, end: view.end };
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const d = drag.current;
    const canvas = canvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dt = ((e.clientX - d.x) / rect.width) * (d.end - d.start);
    let start = d.start - dt;
    let end = d.end - dt;
    if (start < span.start) { start = span.start; end = start + (d.end - d.start); }
    if (end > span.end) { end = span.end; start = end - (d.end - d.start); }
    setView({ start, end });
  }
  function onMouseUp() { drag.current = null; }
```

- [ ] **Step 2: Wire handlers + reset button.** Add `onWheel`, `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave={onMouseUp}` to the `<canvas>`. Above the canvas container add a toolbar:

```tsx
      <div className="flex items-center gap-2 pb-1.5 text-[11px] text-text-dim">
        <button
          type="button"
          onClick={() => setView(span)}
          className="focus-accent cursor-pointer rounded px-1.5 py-0.5 hover:text-foreground"
        >
          Reset zoom
        </button>
        <span>scroll to zoom · drag to pan</span>
      </div>
```

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: scroll zooms toward the cursor; drag pans; reset restores full span; view stays clamped.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx
git commit -m "feat(log): timeline zoom and pan"
```

---

### Task 12: Minimap

A thin strip above the canvas showing the skyline + a viewport lens; click to teleport.

**Files:**
- Modify: `desktop/src/panels/TimelineView.tsx`

- [ ] **Step 1: Render the minimap.** Import `minimapSkyline` from `./flame`. Compute buckets:

```tsx
  const MINI_N = 120;
  const sky = useMemo(() => minimapSkyline(rects, span.start, span.end, MINI_N), [rects, span]);
  const skyMax = useMemo(() => Math.max(1, ...sky), [sky]);
```

Add above the toolbar a minimap that draws bars and a lens, with click-to-teleport:

```tsx
      <div
        className="relative mb-1.5 h-8 w-full cursor-pointer overflow-hidden rounded bg-border/40"
        onMouseDown={(e) => {
          const el = e.currentTarget;
          const r = el.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const t = span.start + frac * (span.end - span.start);
          const w = view.end - view.start;
          let start = t - w / 2;
          let end = start + w;
          if (start < span.start) { start = span.start; end = start + w; }
          if (end > span.end) { end = span.end; start = end - w; }
          setView({ start, end });
        }}
      >
        <div className="flex h-full w-full items-end">
          {sky.map((d, i) => (
            <span
              key={i}
              className="flex-1 bg-slate-500/60"
              style={{ height: `${(d / skyMax) * 100}%` }}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/10"
          style={{
            left: `${((view.start - span.start) / (span.end - span.start)) * 100}%`,
            width: `${((view.end - view.start) / (span.end - span.start)) * 100}%`,
          }}
        />
      </div>
```

- [ ] **Step 2: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: minimap shows density; lens tracks the viewport during zoom/pan; clicking teleports.

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx
git commit -m "feat(log): timeline minimap with viewport lens"
```

---

### Task 13: Hover tooltip

**Files:**
- Modify: `desktop/src/panels/TimelineView.tsx`

- [ ] **Step 1: Track hover.** Add state and use `hitTest`:

```tsx
  const [hover, setHover] = useState<{ x: number; y: number; rect: FlameRect } | null>(null);
```

Import `hitTest` from `./flame`. In `onMouseMove`, when NOT dragging, hit-test and set hover:

```tsx
    if (!d) {
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top + canvas.parentElement!.scrollTop;
      const hit = hitTest(rects, px, py, view.start, view.end, rect.width, ROW_H);
      setHover(hit ? { x: e.clientX - rect.left, y: e.clientY - rect.top, rect: hit } : null);
      return;
    }
```

Add `onMouseLeave={() => { onMouseUp(); setHover(null); }}` to the canvas.

- [ ] **Step 2: Render the tooltip** inside the canvas container (position relative):

```tsx
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded border border-border bg-popover px-2 py-1 text-[11px] shadow"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="truncate font-medium text-foreground">{hover.rect.label}</div>
            <div className="text-text-dim">
              {hover.rect.kind} · {(hover.rect.w / 1_000_000).toFixed(3)} ms
            </div>
          </div>
        )}
```

(Ensure the canvas's parent `div` has `relative`.)

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: hovering a rect shows a tooltip with label, kind, duration.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx
git commit -m "feat(log): timeline hover tooltip"
```

---

### Task 14: Shift-drag measure

**Files:**
- Modify: `desktop/src/panels/TimelineView.tsx`

- [ ] **Step 1: Add measure state + handlers.**

```tsx
  const [measure, setMeasure] = useState<{ x0: number; x1: number } | null>(null);
  const measuring = useRef<number | null>(null);
```

In `onMouseDown`, when `e.shiftKey`, start measuring instead of panning:

```tsx
    if (e.shiftKey) {
      const rect = canvasRef.current!.getBoundingClientRect();
      measuring.current = e.clientX - rect.left;
      setMeasure({ x0: measuring.current, x1: measuring.current });
      return;
    }
```

In `onMouseMove`, when `measuring.current != null`, update `measure.x1`:

```tsx
    if (measuring.current != null) {
      const rect = canvas.getBoundingClientRect();
      setMeasure({ x0: measuring.current, x1: e.clientX - rect.left });
      return;
    }
```

In `onMouseUp`, clear `measuring.current = null;` (keep the `measure` overlay until next drag, or clear after a moment — keep it simple: clear on next shift-down).

- [ ] **Step 2: Render the measure overlay + duration label** inside the relative container:

```tsx
        {measure && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-x border-amber-400 bg-amber-400/10"
              style={{ left: Math.min(measure.x0, measure.x1), width: Math.abs(measure.x1 - measure.x0) }}
            />
            <div
              className="pointer-events-none absolute top-1 z-10 rounded bg-amber-400 px-1 text-[10px] text-black"
              style={{ left: Math.min(measure.x0, measure.x1) }}
            >
              {(() => {
                const w = canvasRef.current?.clientWidth ?? 1;
                const dt = (Math.abs(measure.x1 - measure.x0) / w) * (view.end - view.start);
                return `${(dt / 1_000_000).toFixed(3)} ms`;
              })()}
            </div>
          </>
        )}
```

- [ ] **Step 3: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: shift-drag draws a band and shows the measured duration.

- [ ] **Step 4: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx
git commit -m "feat(log): timeline shift-drag measure"
```

---

### Task 15: Click a rect → jump to source

**Files:**
- Modify: `desktop/src/panels/TimelineView.tsx`

- [ ] **Step 1: Add a click handler** that hit-tests and calls `onSource` when the rect has a source. Distinguish a click from a pan drag by tracking movement:

```tsx
  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top + canvas.parentElement!.scrollTop;
    const hit = hitTest(rects, px, py, view.start, view.end, rect.width, ROW_H);
    if (hit?.source) onSource(hit.source as unknown as SourceRef);
  }
```

Add `onClick={onClick}` to the canvas. To avoid firing after a pan, in `onMouseDown` record the start x, and in `onClick` bail if the pointer moved more than ~4px (compare against the last `drag`/measure start). Minimal guard:

```tsx
  // In onMouseDown (pan branch) also: drag.current = { x, start, end, moved: false }
  // In onMouseMove pan branch set drag.current.moved = true when |dt|>0.
  // In onClick: if the last drag moved, skip. Track via a ref:
```

Implement with a `moved` ref:

```tsx
  const moved = useRef(false);
```

Set `moved.current = false` on mouse down, `moved.current = true` in the pan branch of mouse move, and in `onClick` start with `if (moved.current) return;`.

- [ ] **Step 2: Lint + manual check.**

Run: `cd desktop && npm run lint`
Manually: clicking a method rect with a resolved source jumps to source (same behavior as Tree/Hotspots); panning does not trigger a jump.

- [ ] **Step 3: Commit.**

```bash
git add desktop/src/panels/TimelineView.tsx
git commit -m "feat(log): timeline click-to-source"
```

---

### Task 16: Smoke e2e for the timeline tab

**Files:**
- Create: `desktop/e2e/timeline.spec.ts` (follow the structure of `desktop/e2e/apex-loglist.spec.ts` / `log-debugger.spec.ts`)

- [ ] **Step 1: Write the smoke test.** Mirror the existing log e2e setup (mock/select a log, open the detail view). Assert the timeline tab renders a canvas:

```ts
import { test, expect } from "@playwright/test";
// Reuse the harness/setup from log-debugger.spec.ts (import shared helpers if present).

test("timeline tab renders a flame canvas", async ({ page }) => {
  // ...open a log using the same steps as log-debugger.spec.ts...
  await page.getByRole("button", { name: /timeline/i }).click();
  const canvas = page.locator("canvas");
  await expect(canvas.first()).toBeVisible();
});
```

Adapt the log-open steps to match the existing specs exactly (read `log-debugger.spec.ts` first; do not invent selectors).

- [ ] **Step 2: Run e2e.**

Run: `cd desktop && npx playwright test e2e/timeline.spec.ts`
Expected: PASS (or the project's documented e2e command).

- [ ] **Step 3: Commit.**

```bash
git add desktop/e2e/timeline.spec.ts
git commit -m "test(log): smoke e2e for timeline tab"
```

---

### Task 17: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: All unit tests.** `cd desktop && npx vitest run` → all pass.
- [ ] **Step 2: Rust tests.** `cargo test -p sf-desktop` → all pass.
- [ ] **Step 3: Lint.** `cd desktop && npm run lint` → no new errors.
- [ ] **Step 4: Typecheck/build.** `cd desktop && npm run build` (or the project build command) → succeeds.
- [ ] **Step 5: Manual smoke.** Open a real log: Hotspots bars, time-breakdown strip, query-family bars, and the Timeline (zoom/pan/minimap/hover/measure/click-to-source) all work.
- [ ] **Step 6:** If a CHANGELOG exists, add a user-facing entry for the four visualizations, then commit.

---

## Self-Review

**Spec coverage:**
- Prereq `start_ns` → Tasks 1-2. ✓
- Item 1 hotspot bars → Task 3. ✓
- Item 2 time-breakdown (`timeBreakdown.ts` + component) → Tasks 4-5. ✓
- Item 3 fingerprint + family bars → Tasks 6-7. ✓
- Item 4 flame timeline (layout, geometry, color, canvas, zoom/pan, minimap, hover, measure, click-to-source, e2e) → Tasks 8-16. ✓
- Insights fingerprint reuse: noted as optional in spec; not blocking — left for a follow-up (fingerprint now exists in `queryStats.ts` for it to consume).

**Type consistency:** `FlameRect` fields (`x/w/depth/label/kind/source`) used identically in `flame.ts`, `TimelineView.tsx`, tests. `TimeSlice`/`TimeCategory` consistent across Tasks 4-5. `QueryFamily` consistent across Tasks 6-7. `start_ns` added in both Rust (Task 1) and TS (Task 2) before first use (Task 8).

**Placeholder scan:** No TBD/TODO. E2e task (16) intentionally defers to reading `log-debugger.spec.ts` for exact selectors — flagged explicitly rather than inventing selectors.
