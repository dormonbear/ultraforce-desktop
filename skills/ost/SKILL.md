---
name: ost
description: >-
  Query a Salesforce org's real schema and Apex symbols offline via the
  ultraforce MCP server (ost_* tools) instead of guessing field API names,
  picklist values, or Apex signatures — or paying the ~145s live SymbolTable
  query. Use before writing SOQL/Apex, when verifying a field/object/picklist
  exists, or when checking cross-org schema drift. Triggers: "does <object>
  have <field>", "picklist for", "what fields", "which org has", "Apex class
  members", "SObject describe", "schema drift".
---

# OST — offline org schema + Apex for agents

The `ultraforce` MCP server answers from a local SQLite index of an org (built by
`uf-ost index`). Every org-scoped response is stamped with the org alias and the
snapshot's age — **read the stamp**; it is how you avoid mixing a sandbox's
schema into production code.

## When to consult OST

- **Before writing SOQL or Apex** against an org — confirm the object/field API
  names and types first.
- **Verifying a field, object, or picklist** exists (and its exact API name).
- **Cross-org drift**: is `Custom_Field__c` on the same object, same type, in
  every org? Call `ost_field` with no `org`.
- **Apex members**: class/interface/enum signatures without the slow live
  Tooling SymbolTable query.

## Tools

| Tool | Use |
|---|---|
| `ost_object(org, object)` | fields: name, type, referenceTo, picklist flag, custom |
| `ost_field(field, org?)` | which objects/orgs carry a field (+type); omit `org` for drift |
| `ost_picklist(org, object, field)` | active picklist values (label, value, default) |
| `ost_apex(org, name)` | Apex member signatures (org type or stdlib) |
| `ost_search(query, org)` | FTS fuzzy match over field + Apex-type names |
| `ost_status(org?)` | freshness, counts, `stdlibError`, reindex-in-progress |
| `ost_sync(org)` | **synchronous** watermark delta → `{added, updated, removed}` |
| `ost_reindex(org)` | **async** full reindex → `started` \| `alreadyRunning` |

## Retrieval discipline

1. **Trust but verify freshness.** Check the `age` on every response. If it looks
   stale or you're unsure, call `ost_status`.
2. **On contradiction with observed reality** (a field the code uses isn't in the
   index, or a value the org rejects is listed): call `ost_sync` first — it's
   cheap (seconds) — then re-query.
3. **If sync doesn't reconcile, or staleness is broad**: call `ost_reindex` and
   **do not wait on it**. Fall back to live `sf` CLI queries for the interim;
   poll `ost_reindex` progress via `ost_status`.
4. **stdlib misses are expected when `stdlibError` is set** — a managed package's
   bad metadata can blank the stdlib namespaces. Org types and sObjects are
   unaffected; only `ost_apex` on a System/stdlib type may miss.

## Operating by alias

OST keys everything by **sf org alias**. Pass the alias you use with `sf`
(`--target-org`). One org can appear under multiple aliases; the stamp echoes the
canonical alias so you always know which org you're reading.
