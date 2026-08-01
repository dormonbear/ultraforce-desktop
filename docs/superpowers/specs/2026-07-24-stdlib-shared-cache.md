# Apex stdlib: shared cache + optional CDN

**Date:** 2026-07-24  
**Status:** Phase A implemented 2026-08-01 (`crates/apex-lang/src/shared_stdlib.rs`); Phase B still design-only  
**Decision:** Hybrid — local shared cache by API version first; optional CDN fallback behind a flag.

## Current behaviour

| Piece | Source | Scope today |
| --- | --- | --- |
| Apex stdlib (`System`, `Schema`, …) | Tooling `GET …/tooling/completions?type=apex` | Cached **per org** in `~/.cache/ultraforce/<org>/index.db` (`raw_cache` key `(api_version, "stdlib")`) |
| Org Apex classes | `ApexClass.SymbolTable` | Per org (correct) |
| sObjects | Describe / `sf-schema` | Per org (correct) |

Stdlib fetch is the expensive cold path (~18 MB, often 140–300 s). Design docs already note it only changes on **API version** bumps, yet the store still keys it under each org’s `index.db`, so every new org re-downloads the same payload.

Code anchors:

- `crates/apex-lang/src/acquire.rs` — `fetch_completions` / `parse_stdlib`
- `crates/apex-lang/src/store.rs` — `OstSource::Stdlib` + `get_or_fetch`
- `crates/features/src/index.rs` — index phase `"stdlib"`, fail-loud `stdlib_error`

Constraint (unchanged): data comes from Salesforce first-party endpoints — never the reference IDE plugin’s bundled dataset. See `docs/superpowers/specs/2026-06-19-apex-lang-design.md`.

## Verdict: yes, stdlib is effectively universal

For a given **API version**, `publicDeclarations` is platform standard library, not org schema. Org-specific symbols stay on the SymbolTable / describe paths.

Caveats:

1. Some orgs return empty / error-shaped completions (e.g. managed-package Tooling failures). Those must **not** poison a shared cache.
2. Completions still lack inheritance (`parentClass` empty) — CDN does not fix that.
3. Redistributing raw Salesforce completions JSON on a public CDN needs a light legal/ToS check before enabling by default.

## Target architecture

```
warm / index_org (stdlib phase)
        │
        ▼
  memory (process)
        │ miss
        ▼
  org index.db raw_cache          ← keep for offline snapshot provenance
        │ miss
        ▼
  SHARED local cache              ← NEW: ~/.cache/ultraforce/_shared/stdlib/<api>/
        │ miss
        ▼
  optional CDN (flag off by default)  ← NEW
        │ miss / fail
        ▼
  live Tooling fetch (current path)
        │
        ├─► write SHARED (only if parse_stdlib yields namespaces)
        └─► write org raw_cache + continue index as today
```

Org Apex + sObject indexing is unchanged.

## Phase A — local shared cache (DONE)

Landed as `apex_lang::shared_stdlib` + one branch in `OstStore::get_or_fetch`.
Three things the design above did not anticipate:

- **Writes are atomic** (temp + rename). The uf-ost MCP server is a separate
  process reading the same file; an 18 MB non-atomic write lets it read a
  half-written payload.
- **No `meta.json` sidecar.** Its `sha256` exists to verify CDN bytes — Phase B
  work with no Phase A consumer.
- **`is_usable` replaces re-running `parse_stdlib`** just to test emptiness
  (a test pins the two to the same verdict).

One deliberate behaviour change: invalidating an org (or deleting its
`index.db` via "refresh schema cache") no longer forces a stdlib re-download.
That side effect was never intended — the shared payload is keyed by API
version, so one org going stale says nothing about it. Escape hatch is removing
`<root>/_shared/stdlib/`.

### Original design notes

**Interface (deep module):** one seam for “give me stdlib raw for this `api_version`”, hiding mem / org / shared / network.

Suggested placement:

- Extend `OstStore` (or a thin `StdlibCache` used by it) so `OstSource::Stdlib` resolves via the chain above.
- Shared file path (example):

  `~/.cache/ultraforce/_shared/stdlib/<api_version>/completions.json`

  Optional sidecar: `meta.json` `{ api_version, fetched_at, sha256, source: "live"|"cdn" }`.

**Rules:**

1. Shared write only when `parse_stdlib` returns **non-empty** namespaces.
2. On shared hit, still copy into the org `raw_cache` so per-org snapshots / MCP status stay self-contained.
3. Reindex / invalidate for an org does **not** delete the shared file; a separate “clear shared stdlib” (or API-version bump) does.
4. Keep live fetch as the ultimate fallback — first-party guarantee stays intact without CDN.

**Expected win:** second org (same API version) skips the ~18 MB Tooling round-trip.

## Phase B — optional CDN (flagged)

**Default:** off. Enable via settings or env, e.g. `ULTRAFORCE_STDLIB_CDN=1` + base URL.

**Artifact shape (preferred):** publish **our** parsed, versioned artifact, not a silent mirror of Salesforce’s raw envelope:

- Keyed by API version: `v62.0/stdlib.ost.json` (or `.json.gz`)
- Contents: `Vec<Namespace>` / compact serde of what `parse_stdlib` already produces
- Manifest with `sha256` + `api_version` + `generated_at`

**Publish options:**

| Option | Pros | Cons |
| --- | --- | --- |
| GitHub Release assets on this repo | Simple; jsDelivr `gh` URLs work | Couples releases to desktop versions |
| Dedicated `ultraforce-stdlib` repo + tags per API version | Clean versioning | Extra repo to maintain |
| CI job: scratch/dev org → fetch → parse → upload | Stays first-party origin | Needs a trusted org + secrets |

Example jsDelivr URL (illustrative):

`https://cdn.jsdelivr.net/gh/dormonbear/ultraforce-stdlib@v62.0/stdlib.ost.json`

**Integrity:** verify sha256 from manifest before accepting CDN bytes. On mismatch / HTTP failure → fall through to live fetch.

**Legal / product:** treat public redistribute as an **explicit product decision**. Until cleared, keep flag off; Phase A alone delivers most of the UX win.

## What not to do

- Do not check a full System library into this app repo as a permanent bundled dataset (conflicts with the locked “mechanism, not data” rule).
- Do not share org `SymbolTable` or sObject describe across orgs/users.
- Do not write failed/empty Tooling responses into the shared or CDN pipeline.
- Do not make CDN required for offline use — org snapshot remains the offline completion source after index.

## Implementation sketch (when coding)

1. `StdlibCache::get(api_version)` with lookup order above.
2. Wire `OstStore::get_or_fetch(Stdlib)` through it.
3. Unit tests: shared hit skips invoker; empty parse does not write shared; CDN flag off never HTTP.
4. Settings UI toggle (optional, Phase B): “Download platform stdlib from CDN when missing”.
5. Update this doc + `docs/superpowers/specs/2026-06-19-apex-lang-design.md` caching section when behaviour lands.

## Open questions

1. Publish **raw** completions JSON vs **parsed** OST — parsed is smaller and ours; raw keeps one parser path. Prefer parsed for CDN.
2. Who owns the CI org that regenerates artifacts each Salesforce release?
3. Should desktop Settings expose CDN, or only env for power users at first?
