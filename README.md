# ULTRAFORCE

A fast, local-first Salesforce developer desktop toolkit for running SOQL,
executing anonymous Apex, and reading debug logs — with offline, IntelliSense-grade
code completion for both SOQL and Apex.

Built on a Rust core (Cargo workspace) and a Tauri 2 + React 19 desktop shell.
It drives the official Salesforce CLI (`sf`) under the hood, so it works against
any org you are already authenticated to. All completion data is sourced from
first-party Salesforce endpoints (Tooling API / object describes) — no bundled
third-party metadata.

> Status: personal developer tool, actively developed. APIs and UI may change.

## Features

- **SOQL panel** — Monaco editor with context-aware completion (fields, objects,
  relationships, SOQL functions, clause keywords), unknown-field diagnostics
  driven by live object describes, and `TABLE` / `TREE` result views.
- **Anonymous Apex panel** — run anonymous Apex with per-category debug-level
  pickers (a generated `TraceFlag` / `DebugLevel`), and inspect the result.
- **Logs panel** — master/detail debug-log viewer with status badges, governor
  limits, and tree / limits / raw tabs.
- **Apex completion** — member completion over an offline symbol table (OST):
  stdlib namespaces, every org Apex class (full symbol tables), and sObjects
  (fields + relationships) described on demand. Expression-chain inference,
  generic-collection element unwrap, inheritance/interface flattening.
- **Offline symbol table** — index an org once, then serve completion 100%
  offline. Incremental delta-sync refreshes only what changed on org-select
  (changed classes + sObjects, with deletion reconcile). Bulk object describes
  use the Composite REST API to keep first-index time down.
- **Explorer + workspace** — VS Code-style sidebar over real `*.soql` / `*.apex`
  files on disk, multi-tab editing with debounced autosave, name and full-text
  search with jump-to-line, and run history.

## Architecture

```
crates/
  sf-core/      sf CLI invoker (injectable command runner), org registry, errors
  sf-schema/    object-describe model + on-disk/in-memory cache, Composite REST batch describe
  soql-lang/    SOQL lexer/parser, context-aware completion, field diagnostics
  apex-lang/    Apex symbol model, OST acquisition (stdlib + org classes), snapshot persistence
  log-parser/   debug-log parsing
  features/     orchestration: completion, anonymous Apex, indexing, delta-sync
desktop/
  src/          React 19 + Vite + Tailwind v4 + Monaco frontend
  src-tauri/    Tauri 2 shell exposing the Rust features as commands
```

The Rust crates are pure and unit-tested with an injectable command runner, so
the bulk of the logic is testable without a live org. A separate suite of
real-org end-to-end tests (`#[ignore]` by default) runs against an authenticated
dev org.

## Requirements

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`),
  authenticated to at least one org (`sf org login web`)

## Development

```bash
# Install frontend dependencies
pnpm -C desktop install

# Run the desktop app (Tauri dev)
pnpm -C desktop tauri dev

# Build the Rust workspace
cargo build --workspace

# Run unit tests, lints, and formatting checks
cargo test --workspace
cargo clippy --all-targets -- -D warnings
cargo fmt --check
pnpm -C desktop test        # vitest
pnpm -C desktop e2e         # Playwright (mocked Tauri IPC)
```

Real-org end-to-end tests are opt-in and target the org alias in `UF_E2E_ORG`
(default `ultraforce`):

```bash
UF_E2E_ORG=<your-dev-org-alias> \
  cargo test -p features --test real_org_e2e -- --ignored --test-threads=1
```

## License

[MIT](./LICENSE) © 2026 Dormon Zhou
