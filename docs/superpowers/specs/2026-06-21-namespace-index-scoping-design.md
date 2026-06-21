# Namespace / managed-package index scoping — Design

> Date: 2026-06-21 · Status: Spec (implementation deferred) · Crates: features, desktop
> Roadmap item #3. Reclassified from implement → spec: it spans indexer + settings + UI and
> serves a niche need (most users want the full index). Implement on demand.

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

## Testing (when implemented)

- features unit: a fixture mix of standard + `ns__` names → `"unmanaged"` drops the namespaced
  ones, `"all"` keeps them, an allow-list keeps only the listed prefixes.
- desktop: setting persists; switching it reindexes.

## Why deferred

Niche demand; correctness of the full-index path matters more. No code change until a user needs
scoping.
