# Remaining work roadmap (2026-06-21)

Status of every item still open after the relationship-completion merge. Drives the
feasible-tier implementations and heavy-tier specs requested by the user.

## Feasible tier

| # | Item | Spec | Status |
|---|------|------|--------|
| 1 | SOQL child-subquery completion + diagnostics | `2026-06-21-soql-subquery-completion-design.md` | **DONE** (tested) |
| 2 | Polymorphic relationship completion (union of `referenceTo`) | `2026-06-21-polymorphic-relationship-design.md` | **DONE** (tested) |
| 3 | Namespace / managed-package index scoping | `2026-06-21-namespace-index-scoping-design.md` | **DONE** (sObjects; tested) |
| 4 | Background index polling (the realistic form of "push") | `2026-06-21-background-index-polling-design.md` | **DONE** |

## Heavy tier — spec only (implementation deferred, each is its own multi-week project)

| # | Item | Spec | Note |
|---|------|------|------|
| 5 | LSP-grade semantic Apex completion | `2026-06-21-lsp-apex-completion-design.md` | large; biggest feature |
| 6 | SQLite-backed schema/index store | `2026-06-21-sqlite-store-design.md` | infra migration |
| 7 | Cloud telemetry | `2026-06-21-cloud-telemetry-design.md` | privacy decision required |
| 8 | Signed-release auto-update | `2026-06-21-signed-release-autoupdate-design.md` | needs signing infra |

## Not buildable

- **Real-time push of schema/Apex changes** — Salesforce has no Streaming channel for
  metadata (PushTopic/CDC cover record data only). Item 4 (polling) is the realistic form.
