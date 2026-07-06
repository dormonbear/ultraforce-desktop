# Plan: shrink `ost_object` MCP response (compact text + filter)

## Problem
`ost_object(org, object)` returns **every** field as verbose `Json<ObjectDto>`
(`{"name":...,"type":...,"referenceTo":[],"picklist":false,"custom":false}`).
Lead (~213 fields) → ~12.5k tokens, dumped whole into the calling agent's
context. Root cause: callers usually want a *subset*, and even the genuine
"survey all fields" case is served badly by raw JSON.

## Decision (grilled, locked)
**C — compact text by default + optional name-substring `filter`.** No cap, no
pagination. Sole consumer of this tool is the contract test, so switching the
return shape is safe.

### Output format (text, not JSON)
Header line, then one line per field. Drop the two redundant columns
(`custom` = `__c` suffix; `picklist` = type is already `picklist`). Show
`→ref` only when non-empty. Lean separators, no markdown-table `| |` overhead.

```
Lead (Lead)  prefix=00Q  fields=213  age=2h
Id                  id
MasterRecordId      reference→Lead
Email               email
Status              picklist
EtagChannel__c      picklist
Promoter_Formula__c string
```
When filtering, header reads `fields=213 shown=15`.
Expected: ~12.5k → ~3–4k tokens (full), tiny when filtered.

### Filter
`filter: Option<String>` — case-insensitive substring over field **name only**
(not type; by-type filtering punted). Object-scoped, so distinct from the
org-wide `ost_search`.

## Changes

1. **`crates/uf-ost/src/query.rs`**
   - `object(snap, object, filter: Option<&str>) -> Result<String, QueryError>`:
     read schema, filter fields by name substring (case-insensitive), render
     the text block above. Header from `Stamp` (age) + label + key_prefix +
     total/shown counts.
   - Delete `ObjectDto` and `FieldDto` (orphaned by this change — only used
     here + the test).

2. **`crates/uf-ost/src/server.rs`**
   - `ObjectArgs`: add `filter: Option<String>` with doc
     `"Case-insensitive substring; omit for all fields."`
   - `ost_object` return `Result<String, ErrorData>` (rmcp → text content);
     pass `a.filter.as_deref()`.
   - Description → `"Fields of an sObject as a compact table (name · type ·
     →referenceTo). Pass filter to narrow to fields whose name contains a
     substring, e.g. filter=\"email\"."`
   - Comment noting the deliberate one-off divergence: every other `ost_*`
     tool returns `Json<T>`; `ost_object` is the only firehose, so it returns
     text.

3. **`crates/uf-ost/tests/mcp_contract.rs`**
   - Rewrite the `ost_object` assertions to expect text content: header carries
     org/age, a known field name appears, and a `filter` call narrows the set.

## Verify
- `cargo test -p uf-ost` (contract + query tests green).
- Manual: `ost_object(SFDC_Staging, Lead)` renders compact; with
  `filter="etag"` returns only Etag fields.

## Skipped (YAGNI)
Hard cap / pagination cursor / `fields:[]` projection / by-type filter — add
only if a real object proves unmanageable.
