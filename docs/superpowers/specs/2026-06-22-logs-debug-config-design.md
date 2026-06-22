# Logs panel debug-config (TraceFlag / DebugLevel) — Design

> Date: 2026-06-22 · Status: Approved

## Problem

The Logs panel has no UI to set the running user's **TraceFlag** / **DebugLevel**.
The control already exists (`DebugConfigRow`, used in the Apex panel) and the
backend already supports it (`get_debug_config` / `set_debug_config` Tauri
commands). This work surfaces that control in the Logs panel so a user can raise
log verbosity from where they read logs, without switching to the Apex panel.

## Scope

- **In:** surface the existing `DebugConfigRow` in the Logs panel; extract the
  get/set wiring into a shared hook used by both panels; re-fetch on org change.
- **Out (non-goals):** no backend changes (commands already exist); no TraceFlag
  duration/expiry UI (the existing flow creates a 24h TraceFlag); no auto-refresh
  of the log list after applying (a TraceFlag only affects *future* executions).

## Approach

Reuse `DebugConfigRow` (unchanged) and extract the panel wiring into a shared
hook, so the logic lives in one place and both panels gain org-change refetch.

### Components

| File | Change |
|---|---|
| `desktop/src/useDebugConfig.ts` | **New.** Hook `useDebugConfig(org)`. |
| `desktop/src/panels/DebugConfigRow.tsx` | Unchanged (reused). |
| `desktop/src/panels/ApexPanel.tsx` | Replace inline `levels/cfgApplying/cfgError` + `useEffect` + `applyConfig` with the hook. Behavior unchanged; gains org-change refetch. |
| `desktop/src/panels/LogsPanel.tsx` | Call the hook (org from existing `useOrgs().selected`); render `{levels && <DebugConfigRow .../>}` in the left column, below the toolbar buttons and above the log list. |

### Hook contract

```ts
function useDebugConfig(org: string | null): {
  levels: CategoryLevels | null;   // null until first load
  applying: boolean;
  error: string | null;
  apply: (next: CategoryLevels) => void;
}
```

- On mount and whenever `org` changes → `invoke<DebugConfigDto>("get_debug_config")`
  → `setLevels(dto.levels)`; on failure → `setError`.
- `apply(next)`: `setApplying(true)` → `invoke<DebugConfigDto>("set_debug_config", { levels: next })`
  → `setLevels(dto.levels)` → `setApplying(false)`; on failure → `setError`,
  `setApplying(false)`.

### Data flow notes

- The backend `get/set_debug_config` operate on the **current target org**
  (`AppState.selected_org`, set globally via `set_target_org` on org selection),
  not an org argument. The hook's `org` parameter is therefore only a **re-fetch
  trigger** — matching how `ApexPanel` already behaves.
- Org-switch race: **last-write-wins** (no stale-response guarding). Org changes
  are user-driven and infrequent; extra race handling is YAGNI.

### Error handling

Failures from either command set `error` (string); `DebugConfigRow` already
renders it inline next to the collapse toggle. `applying` drives the inline
spinner. No toasts.

## Testing

The project's vitest is **node-environment, pure-logic only** (no jsdom /
testing-library); UI + IPC wiring is covered by **Playwright e2e** (`e2e/`,
mocked Tauri IPC). A React hook is integration territory, so — following the
existing split — it is covered by e2e rather than a renderHook unit test (which
would require adding DOM test infra against the project's convention). The e2e
harness already mocks `get_debug_config` / `set_debug_config` and records IPC
calls on `window.__ufCalls`.

`e2e/ultraforce.spec.ts` — two tests:

1. **applies a preset:** open Logs → the `DEBUG LEVELS` row is visible (proves the
   mount fetch populated `levels`) → expand → pick the "Apex Only" preset →
   assert `set_debug_config` was threaded with `levels.apexCode === "DEBUG"`.
2. **re-fetch on org change:** open Logs → switch org → assert the
   `get_debug_config` call count increases (the hook's `[org]` re-fetch).

Existing `ApexPanel` behavior is unchanged and continues to be exercised by the
existing apex e2e/completion tests; no new ApexPanel test required.

> Deviation from the approved spec: the originally-planned `useDebugConfig.test.ts`
> vitest unit test is replaced by the e2e tests above, because the repo's vitest
> runs in `node` env with no testing-library. The e2e tests cover the same three
> behaviors (mount fetch, apply, org re-fetch) end-to-end.

## Risks

- Touching `ApexPanel.tsx` (refactor to the hook) — mitigated by keeping the
  hook's behavior identical and relying on the existing app to exercise it.
- `DebugConfigRow`'s category grid is `sm:grid-cols-2 lg:grid-cols-3`; inside the
  narrow left column it collapses to a single column. Acceptable.
