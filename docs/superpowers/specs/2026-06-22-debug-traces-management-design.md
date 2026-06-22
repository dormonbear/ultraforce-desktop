# Debug Traces management ("Configure Logging" dialog) — Design

> Date: 2026-06-22 · Status: Approved

## Problem

The app can only set the **running user's** debug trace (the inline `DebugConfigRow`
quick-set in the Apex/Logs panels). There is no way to view or manage trace flags
for **other users** (or Apex classes/triggers), the way the reference IDE plugin's
"Configure Logging" dialog does. This adds a full Debug Traces / Debug Levels
management dialog modeled on that reference.

## Scope

IC2-near-full parity:

- **In:** a modal "Configure Logging" dialog with two tables — **Debug Levels** and
  **Trace Flags** — covering: list all trace flags in the org; add/edit/delete trace
  flags for any **User**, **ApexClass**, or **ApexTrigger**; LogType; start/expiration
  dates; bulk refresh/remove of expired flags; manage DebugLevel records by name;
  batch save (added/modified/removed committed on Save, discarded on Cancel).
- **Out (non-goals):** advanced DebugLevel fields beyond the existing category levels;
  non-Apex LogTypes; advanced start-date scheduling (defaults to now). The existing
  running-user `DebugConfigRow` quick-set stays as-is (the fast path).

## Architecture

### Backend — `crates/features/src/debug_traces.rs` (new)

Separate from `debug_config.rs` (running-user quick-set, untouched). Uses the same
`SfInvoker` Tooling pattern: `sf data query -t` for reads, `sf data
create/update/delete record -t -s <SObject> -v "k=v"` per record for writes.

Two Tauri commands:

- `load_logging_config()` → `{ traceFlags, debugLevels, entities }` (one dialog-open
  load, mirroring the reference's three queries).
- `save_logging_config(diff)` → applies a batch diff. **Order: DebugLevel
  inserts/updates first** (so new TraceFlags can reference new levels), then TraceFlag
  inserts/updates, then deletes (TraceFlags before referenced DebugLevels). Returns a
  per-record result list (`{ id?, ok, error? }`) — failures are reported, never
  silently dropped.

### Frontend — `desktop/src/`

- `components/LoggingConfigDialog.tsx` — modal (reuses `@/components/ui/dialog`),
  hosts the two tables + Save/Cancel.
- `components/DebugLevelsTable.tsx` — DeveloperName + category levels (reuses the
  `CategoryLevels` model and `LOG_LEVELS`) + add/remove.
- `components/TraceFlagsTable.tsx` — the trace-flags table (below) + add/remove +
  bulk "Refresh expired" / "Remove expired".
- `useLoggingConfig(org)` — loads via `load_logging_config`, holds editable local
  state + `added/modified/removed` sets for both tables, `save()` via
  `save_logging_config`, `reload()`, `dirty` flag.
- **Trigger:** a `⚙ Logging` button in the Logs panel toolbar opens the dialog.

## Data model (DTOs / TS types)

```ts
type TracedEntityKind = "User" | "ApexClass" | "ApexTrigger";
type TraceFlagDto = {
  id: string | null;            // null = locally-added, not yet saved
  logType: string;              // USER_DEBUG | CLASS_TRACING
  tracedEntityId: string;
  tracedEntityName: string;     // resolved (join) for display
  tracedEntityKind: TracedEntityKind;
  debugLevelId: string;
  debugLevelName: string;
  startDate: string;            // ISO; defaults now
  expirationDate: string;       // ISO; <= start + 24h
  creatorName: string;          // read-only
};
type DebugLevelDto = { id: string | null; developerName: string; levels: CategoryLevels };
type EntityDto = { id: string; name: string; kind: TracedEntityKind };
```

## Load → edit → batch-save flow

1. **Load** (`sf data query -t`): TraceFlag (Id, LogType, StartDate, ExpirationDate,
   TracedEntityId, DebugLevelId, CreatedById); DebugLevel (Id, DeveloperName, +
   categories); User (`IsActive=true`: Id, Name, Username); ApexClass / ApexTrigger
   (Id, Name). Names are joined locally for display.
2. **Edit:** table mutations change local state only and record into
   `added/modified/removed`. Bulk "Refresh expired" rewrites expiration (`+2h` or
   `max = now+24h`); "Remove expired" marks expired rows removed.
3. **Save:** commit the diff in dependency order (above); show per-record results;
   `reload()` on success. **Cancel** discards local state.

## UI & editors

**Trace Flags table** columns: **Type · TracedEntity · Creator(read-only) · Start ·
Expiration · DebugLevel**, plus per-row add/remove and the two bulk actions.

- **TracedEntity:** searchable combobox over `entities` (Users + ApexClasses +
  ApexTriggers, each tagged with kind).
- **LogType:** defaults from entity kind (User → `USER_DEBUG`, Class/Trigger →
  `CLASS_TRACING`) as an editable select constrained to valid values — prevents
  invalid Type/Entity combinations.
- **Expiration:** `datetime-local` input, validated `<= start + 24h`; bulk presets
  ("Two Hours" / "Maximum 24h") match the reference.
- **DebugLevel:** select over the Debug Levels table's rows.

**Debug Levels table** columns: **DeveloperName + each category level** (reuses
`CategoryLevels` + `LOG_LEVELS`) + add/remove.

## Error handling

- Each DML result is surfaced per record (success / failure reason); one failure does
  not abort the others.
- Deleting a DebugLevel referenced by a trace flag warns about the cascade (reference
  plugin parity) before removal.
- Load/save transport errors show inline in the dialog; never silent.

## Testing

- **Backend** (`debug_traces` unit tests, mocked `SfInvoker`): query parsing of
  TraceFlag/DebugLevel/User; `save_logging_config` emits the correct `sf` command
  sequence and dependency order (DebugLevel insert before referencing TraceFlag;
  TraceFlag delete before DebugLevel delete).
- **Frontend e2e** (`e2e/`, mock IPC gains `load_logging_config` / `save_logging_config`):
  open the dialog from the Logs toolbar → add a user trace flag → Save → assert
  `save_logging_config` received the expected diff (one added trace flag for the chosen
  user).

## Risks / notes

- Save is per-record `sf` calls (N calls for N changes). Acceptable for a low-frequency
  management task; a Tooling composite/bulk batch is a later optimization.
- Polymorphic `TracedEntityId` names are resolved by separate User/ApexClass/ApexTrigger
  queries + local join (not a polymorphic SOQL relationship), matching the reference.
