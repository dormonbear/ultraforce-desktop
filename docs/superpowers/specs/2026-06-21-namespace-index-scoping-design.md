# Namespace / managed-package index scoping — Design

> Date: 2026-06-21 · Status: IMPLEMENTED · Crates: features, desktop
> Roadmap item #3.

## Problem

`index_org` indexes every Apex class and sObject, including managed-package members (namespaced
`ns__Foo`). On large managed-package orgs that bloats the index and the completion list. Some
users want completion scoped to their own namespace (or a chosen allow-list).

## Design

1. **Setting** (`desktop`, persisted via the store): `index.namespaces` = one of
   `"all"` (default) | `"unmanaged"` (drop anything with a namespace prefix) | an explicit
   allow-list of namespace prefixes.

2. **Indexer filter** (`features/index.rs`): after `parse_org_types` and the sObject describes,
   drop entries whose name carries a namespace prefix not permitted by the setting. Namespace
   prefix = the segment before `__` for a managed name (`ns__Account` → `ns`); standard names
   (`Account`, `MyClass`) have none and always pass. Thread the policy into `index_org` /
   `sync_org` as a parameter; `desktop` reads the setting and passes it.

3. **UI** (`desktop`): a Settings control to pick the policy; changing it triggers a `reindex_org`.

## As built

- `features::index::NamespacePolicy` (`All` | `Unmanaged` | `Allow(Vec<String>)`) with
  `namespace_of` (strip a known custom suffix, then a remaining `__` marks the namespace) and
  `parse("all"|"unmanaged"|"ns1,ns2")`. Threaded into `index_org` / `sync_org`; both filter
  sObject names by the policy.
- **sObjects only.** Apex class names from `ApexClass.Name` carry no namespace prefix
  (`NamespacePrefix` isn't queried), so managed classes aren't filtered (documented `ponytail:`
  note in `index.rs`). Filtering them would need an extra query — out of scope.
- desktop: `index_org`/`reindex_org` commands take a `namespaces` arg; `org.tsx` and
  `SchemaRefresh` pass the saved policy; `WorkspaceSettings` exposes an "Index scope" select
  (All / Unmanaged only) that persists and reindexes the active org. Default `all` (no behaviour
  change).

## Testing

- features unit: `namespace_of`, `NamespacePolicy::permits`, `NamespacePolicy::parse`.
- Existing index/sync tests pass `NamespacePolicy::All` (parity).
- desktop: tsc + vitest + Playwright e2e green.
