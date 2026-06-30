# Offline Apex Log Step-Debugger

## Goal

Turn an already-parsed debug log into a replayable, IDE-style step-debugging
session — **fully offline**, no org connection, no checkpoint/launch config.
Step through executed source lines, see the call stack, and (when the log was
captured at `APEX_CODE=FINEST`) inspect variable values at each step.

This is the offline cousin of Salesforce's official Apex Replay Debugger.
Certinia LANA (the popular community tool) does flame charts / call trees but
**not** variable-level stepping, so this is the differentiating capability.

## Non-goals (YAGNI for v1)

Auto-play timer, breakpoints, conditional stepping, watch expressions,
nested-object / heap deep expansion (variable values shown as their raw value
string). Add later if a real need appears.

## Constraint

Variable values come from `VARIABLE_ASSIGNMENT` events, present **only** at
`APEX_CODE=FINEST`. At lower levels stepping + call stack still work; the
Variables panel shows a hint to raise the log level. Graceful degradation, not
an error.

## Architecture (Rust is the single source of truth)

### 1. Parser: variable events (`crates/log-parser/src/event.rs`)

Add two `LogEvent` variants, both `ScopeKind::Leaf`:

- `VariableScopeBegin` ← `VARIABLE_SCOPE_BEGIN` — params `[line]|name|type|...`
- `VariableAssignment` ← `VARIABLE_ASSIGNMENT` — params `[line]|name|value|...`

### 2. Session builder (`crates/log-parser/src/debug_session.rs`, new)

```
struct VarValue { name: String, type_name: Option<String>, value: String }
struct Frame    { class_name: String, line: Option<u32>, signature: String,
                  variables: Vec<VarValue> }
struct Step     { entry_index: usize, source: SourceRef, depth: usize,
                  frames: Vec<Frame> }
struct DebugSession { steps: Vec<Step> }
```

`build_session(unit: &ExecUnit) -> DebugSession`:

- **Stop points** = entries with a resolved `SourceRef` whose `line.is_some()`,
  **excluding** the bookkeeping events `VariableScopeBegin`, `VariableAssignment`,
  `HeapAllocate`. Each stop point becomes one `Step`.
- A single forward pass maintains a **frame stack** mirroring the scope stack
  (push on `ScopeKind::Start` entries that resolve a class; pop on `End`):
  - `VariableScopeBegin` → add `VarValue { name, type_name, value: "" }` to the
    top frame if absent.
  - `VariableAssignment` → set `value` on the top frame's matching var (by name);
    if undeclared, add it. (`value` = first field after name; JSON containing
    `|` is a known ceiling — ponytail comment.)
  - Each entry with a line updates the top frame's `line`.
  - Variables live with their frame and are cleared when the frame pops (the log
    has no `VARIABLE_SCOPE_END`; accumulate-per-frame matches reality).
- At each stop point, snapshot the current frame stack (deep clone) into the
  `Step`. `depth = frames.len()`.

Full per-step snapshots are computed in one pass and returned whole.
**Ceiling:** memory is `O(steps × depth × vars)`. FINEST logs are small (they
hit the 20MB cap on short transactions), so this is fine for v1; if a large log
lags, switch to a lazy `frames_at(unit, entry_index)` recomputed per step.

### 3. DTO + command (`desktop/src-tauri`)

`DebugSessionDto { steps: Vec<StepDto> }`, `StepDto { entry_index, source,
depth, frames }`, `FrameDto { class_name, line, signature, variables }`,
`VarDto { name, type_name, value }` — all `camelCase`. Command
`debug_session(raw: String, unit_index: usize) -> DebugSessionDto`.

### 4. Frontend step state machine (`desktop/src/panels/stepDebug.ts`, new)

Pure functions over `steps[]` using `depth` (zero server round-trips):

- `stepInto(i)` = `i + 1`
- `stepPrev(i)` = `i - 1`
- `stepOver(i)` = next `j > i` with `steps[j].depth <= steps[i].depth`, else end
- `stepOut(i)`  = next `j > i` with `steps[j].depth <  steps[i].depth`, else end
- clamp to `[0, steps.length - 1]`

### 5. UI (`desktop/src/components/LogDebugger.tsx`, new)

Extract SourceDialog's Monaco fetch+reveal into a shared `useApexSource` hook;
SourceDialog keeps doing plain jump-to-source, `LogDebugger` is the larger
sibling: Monaco source (highlights current line) + Call Stack panel + Variables
panel + step controls (Prev / Into / Over / Out / Next, jump to start/end).
Clicking a stack frame reveals that frame's class+line. Variables panel shows
the FINEST hint when empty. Entry: a ▶ Debug button in the Logs panel (starts
at step 0); clicking a source line can start at that line.

## Testing (required: full unit + e2e)

- **Rust:** variable-event parsing; `build_session` stop-point selection
  (bookkeeping excluded); frame stack + variable values across into/over/out
  depths; nested frames; FINEST-missing → empty variables.
- **Frontend:** `stepInto/Prev/Over/Out` index math incl. boundaries.
- **e2e:** mock `debug_session`; stepping changes the highlighted line; call
  stack renders; variable values display; FINEST-missing shows the hint.
