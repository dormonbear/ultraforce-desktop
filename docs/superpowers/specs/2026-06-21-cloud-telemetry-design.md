# Cloud telemetry — Design (heavy tier, spec only — needs product/privacy sign-off)

> Date: 2026-06-21 · Status: Spec (implementation deferred — requires explicit opt-in decision)
> Crates: desktop, a new collector endpoint. Roadmap item #7.

## Goal

Optional, anonymous usage/error telemetry to guide development (which panels are used, error
rates, index timings).

## Hard prerequisites (decisions, not code)

1. **Opt-in, off by default.** No data leaves the machine unless the user enables it. A desktop
   app touching customer Salesforce orgs must not exfiltrate anything silently.
2. **No org data, ever.** Never send query text, schema, record data, org names, usernames, or
   instance URLs. Only coarse events (e.g. `panel_opened: soql`, `index_duration_ms` bucketed,
   `error_kind` without messages).
3. **Endpoint + retention owner.** Where it lands, who can read it, retention window, deletion
   path — all defined before any collection.

## Design sketch (only after the above are settled)

- A `telemetry` setting (off default) in the desktop store.
- A tiny event queue flushed over HTTPS to the agreed endpoint; batched, best-effort, dropped on
  failure (never blocks the UI).
- An allow-list of event names + typed payloads; a compile-time check that payloads carry no
  free-form strings.
- Visible disclosure in Settings: exactly what is sent, with a link to the policy.

## Why deferred

This is a product/privacy decision, not an engineering task. Do not implement until opt-in model,
data scope, and endpoint ownership are explicitly approved.

## Testing (when implemented)

- desktop unit: events serialize to the allow-listed shape; nothing sent when the setting is off;
  payload scrubber rejects free-form strings.
