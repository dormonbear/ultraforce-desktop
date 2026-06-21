# Background index polling — Design

> Date: 2026-06-21 · Status: Approved · Crate: desktop (frontend only)
> Feasible-tier item #4 of `2026-06-21-remaining-work-roadmap.md`. The realistic form of
> "real-time push" (Salesforce has no metadata Streaming channel).

## Goal

Keep the offline schema/Apex index fresh while the app is open, without the user re-selecting
the org. Poll for changes every few minutes.

## Design

`index_org` already does the right thing when a snapshot exists: it installs the snapshot, runs
a **delta** `sync_org`, and emits a `sync-result` toast only when something changed — no progress
bar. So polling is pure frontend: while an org is selected, `setInterval` calls
`invoke("index_org", { org })` every 5 minutes; cleared on org change / unmount.

`OrgProvider` (`desktop/src/org.tsx`) gains one `useEffect` keyed on `selected`. Fixed 5-minute
interval (`// ponytail: fixed 5-min poll; make configurable if users ask`).

## Testing

The change is trivial glue (a `setInterval` calling an existing command). Verified by `pnpm build`
(tsc types) and the existing vitest + Playwright suites staying green. A timer-driven unit test
would only assert React/`setInterval` internals — skipped per YAGNI.

## Out of scope

- Configurable interval / pause control.
- Visible "last synced" indicator (the existing sync-result toast already signals changes).
