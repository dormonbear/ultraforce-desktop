# Contributing to ULTRAFORCE

Thanks for your interest in contributing! This is a Salesforce developer desktop
toolkit built on a Rust workspace + Tauri 2 / React 19 shell.

## Ways to contribute

- **Report a bug** — open a [Bug report](https://github.com/dormonbear/ultraforce-desktop/issues/new?template=bug_report.yml).
- **Request a feature** — open a [Feature request](https://github.com/dormonbear/ultraforce-desktop/issues/new?template=feature_request.yml).
- **Ask a question** — use [Discussions](https://github.com/dormonbear/ultraforce-desktop/discussions), not issues.
- **Report a security issue** — privately, see [SECURITY.md](SECURITY.md). Never in a public issue.

## Development setup

Prerequisites: [Rust](https://www.rust-lang.org/tools/install) (stable),
[Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/),
[Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`).

```bash
pnpm -C desktop install        # frontend deps
pnpm -C desktop tauri dev      # run the desktop app
cargo build --workspace        # build the Rust workspace
```

### Tests, lints, formatting (run before opening a PR)

```bash
cargo test --workspace
cargo clippy --all-targets -- -D warnings
cargo fmt --check
pnpm -C desktop test           # vitest
pnpm -C desktop e2e            # Playwright (mocked Tauri IPC)
```

Real-org end-to-end tests are opt-in (`#[ignore]` by default):

```bash
UF_E2E_ORG=<your-dev-org-alias> \
  cargo test -p features --test real_org_e2e -- --ignored --test-threads=1
```

## Commit & PR conventions

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)** —
they are required because version bumps, the `CHANGELOG`, and releases are
generated automatically by release-please (see [docs/RELEASE.md](docs/RELEASE.md)).

| Prefix | Use for | Version effect (<1.0) |
|---|---|---|
| `fix:` | bug fixes | patch |
| `feat:` | new features | minor |
| `feat!:` / `BREAKING CHANGE:` | breaking changes | minor |
| `docs:` `chore:` `refactor:` `test:` `ci:` | non-shipping changes | none |

- **Follow [GitHub Flow](docs/WORKFLOW.md)**: branch off `main` and PR back into it.
  `main` is protected — never commit to it directly.
- **PR title must be a Conventional Commit** — it drives the release notes.
- Keep changes surgical and focused; match the surrounding code style.
- For language-tooling work (Apex/SOQL completion, resolution, diagnostics),
  model Apex types on the Salesforce Tooling API `SymbolTable`.

## Project layout

```
crates/          Pure, unit-tested Rust core (apex-lang, soql-lang, sf-schema, ...)
desktop/         Tauri 2 + React 19 shell
desktop/src-tauri/   Rust side exposing features as Tauri commands
docs/            Plans, specs, and RELEASE.md
```

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
