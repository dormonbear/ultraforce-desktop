# log-parser (SP-A core) — design

> Date: 2026-06-18 · Status: Approved · Crate: `crates/log-parser` · Depends on: nothing (pure)

## Purpose

Pure, zero-dependency Rust crate that turns a raw Salesforce Apex debug log (the
`logs` string from `sf apex run`, or `sf apex get log`) into structured data:
header, flat execution units, a nested execution tree, and a governor-limit
rollup. No IO, no `sf`, no UI — text in, structures out. Consumed by SP-A
(Debug Log feature) and SP-C (Anonymous Apex feature).

Ported from that plugin's `ParsedApexLog` / `ApexLogEntry` / `ApexLogHeader`, adapted to
Rust (that plugin generates synthetic data for IntelliJ; we just need queryable structs).

## Log format (verified against a real staging log)

```
67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO          <- line 1: header
Execute Anonymous: System.debug('hello');          <- non-timestamped preamble (dropped)
16:55:57.42 (42826462)|USER_INFO|[EXTERNAL]|005..  <- entry: ts | event | params...
16:55:57.42 (42845776)|EXECUTION_STARTED
16:55:57.42 (42853601)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex
16:55:57.42 (43230894)|USER_DEBUG|[1]|DEBUG|hello from fixture
16:55:57.146 (146455625)|CUMULATIVE_LIMIT_USAGE
16:55:57.146 (146455625)|LIMIT_USAGE_FOR_NS|(default)|
  Number of SOQL queries: 1 out of 100                <- continuation lines (appended to prev entry)
  Maximum CPU time: 0 out of 10000
16:55:57.146 (146455625)|CUMULATIVE_LIMIT_USAGE_END
16:55:57.42 (146500361)|CODE_UNIT_FINISHED|execute_anonymous_apex
16:55:57.42 (146508550)|EXECUTION_FINISHED
```

- **Header** (line 1): `<apiVersion> <CAT,LEVEL;CAT,LEVEL;...>` — split on first space; second part split on `;`, each `CATEGORY,LEVEL`.
- **Entry**: split on `|`. `[0]` = timestamp matching `HH:MM:SS.frac (nanos)`, `[1]` = event name `[A-Za-z0-9_]+`, `[2..]` = params. Both `[0]` and `[1]` must match or the line is not an entry.
- **Continuation**: a line that is not a valid entry is appended (as a new param) to the most recent entry. Continuation lines before any entry (the "Execute Anonymous:" preamble) are dropped.
- Unknown event name → `LogEvent::Other(name)`.

## Decisions

1. **Curated event enum + `Other(String)`** — model only structurally-significant events as variants; everything else keeps its raw name in `Other`. Rationale: tree-building and limit extraction only branch on these; transcribing that plugin's 200+ variants we never match is waste.
2. **Zero runtime dependencies** — hand-roll timestamp/event validation (no `regex` crate). std only.
3. **Category/level**: header levels kept as raw `(String, String)` pairs. No per-event category/level table in this crate (that is a UI-filter concern for SP-A.4; add later if needed).
4. **Tree is separate from parse** — `ParsedLog` is flat (feature parity: units split on `EXECUTION_STARTED`/`EXECUTION_FINISHED`). Nesting is built on demand by the `tree` module from scope start/end pairing.
5. **Deferred**: hotspot caller/callee aggregation (later); SOQL/DML/method-level detail beyond what the structural events carry.

## Modules

| Module | Responsibility | Key types / fns |
|---|---|---|
| `event` | event modeling | `enum LogEvent { ExecutionStarted, ExecutionFinished, CodeUnitStarted, CodeUnitFinished, MethodEntry, MethodExit, ConstructorEntry, ConstructorExit, SoqlExecuteBegin, SoqlExecuteEnd, DmlBegin, DmlEnd, CalloutRequest, CalloutResponse, UserDebug, CumulativeLimitUsage, CumulativeLimitUsageEnd, LimitUsageForNs, FatalError, ExceptionThrown, Other(String) }`; `LogEvent::from_name(&str)`; `fn scope_kind(&self) -> ScopeKind { Start, End, Leaf }` |
| `header` | line-1 parse | `struct LogHeader { api_version: String, levels: Vec<(String,String)> }`; `LogHeader::parse(&str) -> Option<LogHeader>` |
| `entry` | one line → entry | `struct LogEntry { timestamp: String, nanos: u64, event: LogEvent, params: Vec<String> }`; `parse_entry(&str) -> Option<LogEntry>`; helper `is_timestamp(&str)->bool` |
| `parse` | whole log → flat units | `struct ParsedLog { header: Option<LogHeader>, units: Vec<ExecUnit> }`; `struct ExecUnit { entries: Vec<LogEntry> }`; `ParsedLog::parse(&str) -> ParsedLog` |
| `tree` | nesting from scope pairs | `struct ExecNode { entry: LogEntry, children: Vec<ExecNode>, dur_ns: Option<u64> }`; `build_tree(&ExecUnit) -> Vec<ExecNode>` |
| `limits` | governor-limit rollup | `struct LimitEntry { name: String, used: u64, max: u64 }`; `struct LimitRollup { entries: Vec<LimitEntry> }`; `extract_limits(&ExecUnit) -> Vec<LimitRollup>` |

## Tree-building rules

Maintain a stack. For each entry in unit order:
- `scope_kind == Start` → push a new `ExecNode`.
- `scope_kind == End` → pop top node; set `dur_ns = end.nanos - start.nanos`; attach popped node to the new top's children (or to roots if stack now empty). Unmatched End (empty stack) → attach as a root leaf.
- `scope_kind == Leaf` → attach as a child of the current top (or a root if stack empty).

`scope_kind` by suffix: `_STARTED`/`_ENTRY`/`_BEGIN` = Start; `_FINISHED`/`_EXIT`/`_END` = End; otherwise Leaf. `CumulativeLimitUsage`/`CumulativeLimitUsageEnd` follow the same suffix rule.

## Limit extraction

Within a unit, find `CUMULATIVE_LIMIT_USAGE` … `CUMULATIVE_LIMIT_USAGE_END` ranges. The limit numbers live as continuation params on the `LIMIT_USAGE_FOR_NS` entry, each line `  <Name>: <used> out of <max>`. Parse each into `LimitEntry`. One `LimitRollup` per namespace block.

## Testing

- **Golden fixture**: a real (sanitized) staging log at `crates/log-parser/tests/fixtures/anon_apex.log` drives an end-to-end test asserting header api_version, unit count, the nested tree shape (EXECUTION → CODE_UNIT → USER_DEBUG/limit), and the parsed limits (SOQL 1/100, CPU 0/10000, heap 0/6000000).
- **Crafted snippets**: unit tests for edge cases — continuation-line appending, preamble drop, unmatched End, unknown event → `Other`, multi-line USER_DEBUG.
- Pure crate → TDD throughout, no mocks needed.
