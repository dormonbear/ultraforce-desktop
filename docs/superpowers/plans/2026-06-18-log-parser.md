# log-parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the pure `log-parser` crate that turns a raw Salesforce Apex debug log into header + flat execution units + a nested execution tree + a governor-limit rollup.

**Architecture:** Zero-dependency, std-only crate. Line-oriented parse: header (line 1), entries (`ts|event|params`), continuation lines appended to the previous entry. `ParsedLog` is flat (units split on EXECUTION_STARTED/FINISHED); `tree` and `limits` are computed on demand from a unit.

**Tech Stack:** Rust 2021, std only (no external crates).

## Global Constraints

- Rust edition 2021. Crate lives at `crates/log-parser` in the existing `sf-toolkit` workspace (`/Users/dormonzhou/Projects/sf-toolkit`), whose root `Cargo.toml` already has `members = ["crates/*"]`.
- **Zero runtime dependencies** — std only. No `regex`, no serde. Hand-roll all parsing.
- Pure: no IO, no `sf`, no UI. Functions take `&str`/structs and return structs.
- English code/comments. Conventional commits (`feat:`, `test:`, `chore:`), NO author-attribution/"Co-Authored-By" trailer.
- TDD per task. Test output must be pristine (no warnings). Run `cargo test -p log-parser`; full crate build `cargo build -p log-parser`; `cargo clippy -p log-parser` clean.
- You are on git branch `log-parser`. Never create/switch branches, never `git push`.

---

### Task 1: Crate scaffold + golden fixture

**Files:**
- Create: `crates/log-parser/Cargo.toml`
- Create: `crates/log-parser/src/lib.rs`
- Create: `crates/log-parser/tests/fixtures/anon_apex.log`

**Interfaces:**
- Produces: a buildable `log-parser` crate and the golden log fixture used by later tasks' integration tests.

- [ ] **Step 1: Create the crate manifest**

`crates/log-parser/Cargo.toml`:

```toml
[package]
name = "log-parser"
version = "0.1.0"
edition.workspace = true
license.workspace = true

[dependencies]
```

- [ ] **Step 2: Create lib.rs with module declarations (modules added per task)**

`crates/log-parser/src/lib.rs`:

```rust
//! log-parser: pure parser for Salesforce Apex debug logs.

pub mod entry;
pub mod event;
pub mod header;
pub mod limits;
pub mod parse;
pub mod tree;
```

Note: the module files do not exist yet — this will not compile until Task 2+. To keep Task 1's deliverable buildable, create empty placeholder files now:

```bash
cd /Users/dormonzhou/Projects/sf-toolkit
mkdir -p crates/log-parser/src crates/log-parser/tests/fixtures
for m in entry event header limits parse tree; do printf '' > crates/log-parser/src/$m.rs; done
```

- [ ] **Step 3: Create the golden fixture**

`crates/log-parser/tests/fixtures/anon_apex.log` (exact content, including the leading non-timestamped "Execute Anonymous:" lines, the indented limit lines, and the blank lines):

```
67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO
Execute Anonymous: System.debug('hello from fixture');
Execute Anonymous: Integer userCount = [SELECT count() FROM User];
Execute Anonymous: System.debug(LoggingLevel.INFO, 'user count = ' + userCount);
16:55:57.42 (42826462)|USER_INFO|[EXTERNAL]|005000000000000AAA|user@example.com|(GMT+08:00) China Standard Time (Asia/Shanghai)|GMT+08:00
16:55:57.42 (42845776)|EXECUTION_STARTED
16:55:57.42 (42853601)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex
16:55:57.42 (43230894)|USER_DEBUG|[1]|DEBUG|hello from fixture
16:55:57.42 (146374450)|USER_DEBUG|[3]|INFO|user count = 100000
16:55:57.146 (146455625)|CUMULATIVE_LIMIT_USAGE
16:55:57.146 (146455625)|LIMIT_USAGE_FOR_NS|(default)|
  Number of SOQL queries: 1 out of 100
  Number of query rows: 1 out of 50000
  Number of SOSL queries: 0 out of 20
  Number of DML statements: 0 out of 150
  Number of Publish Immediate DML: 0 out of 150
  Number of DML rows: 0 out of 10000
  Maximum CPU time: 0 out of 10000
  Maximum heap size: 0 out of 6000000
  Number of callouts: 0 out of 100
  Number of Email Invocations: 0 out of 10
  Number of future calls: 0 out of 50
  Number of queueable jobs added to the queue: 0 out of 50
  Number of Mobile Apex push calls: 0 out of 10

16:55:57.146 (146455625)|CUMULATIVE_LIMIT_USAGE_END

16:55:57.42 (146500361)|CODE_UNIT_FINISHED|execute_anonymous_apex
16:55:57.42 (146508550)|EXECUTION_FINISHED
```

- [ ] **Step 4: Verify it builds**

Run: `cd /Users/dormonzhou/Projects/sf-toolkit && cargo build -p log-parser && cargo test -p log-parser`
Expected: builds; 0 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/log-parser
git commit -m "chore(log-parser): scaffold crate and golden log fixture"
```

---

### Task 2: event module

**Files:**
- Modify: `crates/log-parser/src/event.rs`

**Interfaces:**
- Produces: `enum LogEvent` (curated variants + `Other(String)`), `LogEvent::from_name(&str) -> LogEvent`, `enum ScopeKind { Start, End, Leaf }`, `LogEvent::scope_kind(&self) -> ScopeKind`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/event.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_event_names() {
        assert_eq!(LogEvent::from_name("EXECUTION_STARTED"), LogEvent::ExecutionStarted);
        assert_eq!(LogEvent::from_name("USER_DEBUG"), LogEvent::UserDebug);
        assert_eq!(LogEvent::from_name("LIMIT_USAGE_FOR_NS"), LogEvent::LimitUsageForNs);
    }

    #[test]
    fn unknown_event_name_becomes_other() {
        assert_eq!(
            LogEvent::from_name("FLOW_ELEMENT_BEGIN"),
            LogEvent::Other("FLOW_ELEMENT_BEGIN".to_string())
        );
    }

    #[test]
    fn scope_kind_of_known_events() {
        assert_eq!(LogEvent::ExecutionStarted.scope_kind(), ScopeKind::Start);
        assert_eq!(LogEvent::CodeUnitFinished.scope_kind(), ScopeKind::End);
        assert_eq!(LogEvent::UserDebug.scope_kind(), ScopeKind::Leaf);
    }

    #[test]
    fn scope_kind_of_other_uses_suffix() {
        assert_eq!(LogEvent::from_name("FLOW_X_BEGIN").scope_kind(), ScopeKind::Start);
        assert_eq!(LogEvent::from_name("FLOW_X_END").scope_kind(), ScopeKind::End);
        assert_eq!(LogEvent::from_name("SOME_DETAIL").scope_kind(), ScopeKind::Leaf);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser event::`
Expected: FAIL — `LogEvent` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/event.rs` (above the test module):

```rust
/// A debug-log event. Only structurally-significant events get a variant;
/// everything else keeps its raw name in `Other`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogEvent {
    ExecutionStarted,
    ExecutionFinished,
    CodeUnitStarted,
    CodeUnitFinished,
    MethodEntry,
    MethodExit,
    ConstructorEntry,
    ConstructorExit,
    SoqlExecuteBegin,
    SoqlExecuteEnd,
    DmlBegin,
    DmlEnd,
    CalloutRequest,
    CalloutResponse,
    UserDebug,
    CumulativeLimitUsage,
    CumulativeLimitUsageEnd,
    LimitUsageForNs,
    FatalError,
    ExceptionThrown,
    Other(String),
}

/// Whether an event opens a scope, closes one, or is a standalone leaf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeKind {
    Start,
    End,
    Leaf,
}

impl LogEvent {
    pub fn from_name(name: &str) -> LogEvent {
        match name {
            "EXECUTION_STARTED" => LogEvent::ExecutionStarted,
            "EXECUTION_FINISHED" => LogEvent::ExecutionFinished,
            "CODE_UNIT_STARTED" => LogEvent::CodeUnitStarted,
            "CODE_UNIT_FINISHED" => LogEvent::CodeUnitFinished,
            "METHOD_ENTRY" => LogEvent::MethodEntry,
            "METHOD_EXIT" => LogEvent::MethodExit,
            "CONSTRUCTOR_ENTRY" => LogEvent::ConstructorEntry,
            "CONSTRUCTOR_EXIT" => LogEvent::ConstructorExit,
            "SOQL_EXECUTE_BEGIN" => LogEvent::SoqlExecuteBegin,
            "SOQL_EXECUTE_END" => LogEvent::SoqlExecuteEnd,
            "DML_BEGIN" => LogEvent::DmlBegin,
            "DML_END" => LogEvent::DmlEnd,
            "CALLOUT_REQUEST" => LogEvent::CalloutRequest,
            "CALLOUT_RESPONSE" => LogEvent::CalloutResponse,
            "USER_DEBUG" => LogEvent::UserDebug,
            "CUMULATIVE_LIMIT_USAGE" => LogEvent::CumulativeLimitUsage,
            "CUMULATIVE_LIMIT_USAGE_END" => LogEvent::CumulativeLimitUsageEnd,
            "LIMIT_USAGE_FOR_NS" => LogEvent::LimitUsageForNs,
            "FATAL_ERROR" => LogEvent::FatalError,
            "EXCEPTION_THROWN" => LogEvent::ExceptionThrown,
            other => LogEvent::Other(other.to_string()),
        }
    }

    pub fn scope_kind(&self) -> ScopeKind {
        use LogEvent::*;
        match self {
            ExecutionStarted | CodeUnitStarted | MethodEntry | ConstructorEntry
            | SoqlExecuteBegin | DmlBegin | CumulativeLimitUsage => ScopeKind::Start,
            ExecutionFinished | CodeUnitFinished | MethodExit | ConstructorExit
            | SoqlExecuteEnd | DmlEnd | CumulativeLimitUsageEnd => ScopeKind::End,
            Other(name) => scope_kind_by_suffix(name),
            _ => ScopeKind::Leaf,
        }
    }
}

fn scope_kind_by_suffix(name: &str) -> ScopeKind {
    if name.ends_with("_STARTED") || name.ends_with("_ENTRY") || name.ends_with("_BEGIN") {
        ScopeKind::Start
    } else if name.ends_with("_FINISHED") || name.ends_with("_EXIT") || name.ends_with("_END") {
        ScopeKind::End
    } else {
        ScopeKind::Leaf
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p log-parser event::`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/log-parser/src/event.rs
git commit -m "feat(log-parser): add LogEvent and scope classification"
```

---

### Task 3: header module

**Files:**
- Modify: `crates/log-parser/src/header.rs`

**Interfaces:**
- Produces: `struct LogHeader { api_version: String, levels: Vec<(String, String)> }`, `LogHeader::parse(&str) -> Option<LogHeader>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/header.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_header() {
        let h = LogHeader::parse("67.0 APEX_CODE,DEBUG;APEX_PROFILING,INFO").unwrap();
        assert_eq!(h.api_version, "67.0");
        assert_eq!(
            h.levels,
            vec![
                ("APEX_CODE".to_string(), "DEBUG".to_string()),
                ("APEX_PROFILING".to_string(), "INFO".to_string()),
            ]
        );
    }

    #[test]
    fn rejects_non_header_line() {
        assert!(LogHeader::parse("16:55:57.42 (1)|USER_DEBUG|x").is_none());
        assert!(LogHeader::parse("").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser header::`
Expected: FAIL — `LogHeader` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/header.rs` (above the test module):

```rust
/// Parsed first line of a debug log: API version plus category→level pairs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogHeader {
    pub api_version: String,
    pub levels: Vec<(String, String)>,
}

impl LogHeader {
    /// `<apiVersion> <CAT,LEVEL;CAT,LEVEL;...>`. Returns None if the line does
    /// not start with a version-like token.
    pub fn parse(line: &str) -> Option<LogHeader> {
        let line = line.trim();
        let (api, rest) = line.split_once(' ')?;
        // A version token is digits and dots only (e.g. "67.0"); this rejects
        // entry lines whose first field is a timestamp like "16:55:57.42".
        if api.is_empty() || !api.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
            return None;
        }
        let mut levels = Vec::new();
        for pair in rest.split(';') {
            if let Some((cat, lvl)) = pair.split_once(',') {
                levels.push((cat.to_string(), lvl.to_string()));
            }
        }
        Some(LogHeader {
            api_version: api.to_string(),
            levels,
        })
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p log-parser header::`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/log-parser/src/header.rs
git commit -m "feat(log-parser): parse log header line"
```

---

### Task 4: entry module

**Files:**
- Modify: `crates/log-parser/src/entry.rs`

**Interfaces:**
- Consumes: `LogEvent` from `crate::event`.
- Produces: `struct LogEntry { timestamp: String, nanos: u64, event: LogEvent, params: Vec<String> }`, `parse_entry(&str) -> Option<LogEntry>`, `parse_timestamp(&str) -> Option<u64>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/entry.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::LogEvent;

    #[test]
    fn parses_timestamp_to_nanos() {
        assert_eq!(parse_timestamp("16:55:57.42 (42826462)"), Some(42826462));
        assert_eq!(parse_timestamp("16:55:57.146 (146455625)"), Some(146455625));
    }

    #[test]
    fn rejects_bad_timestamp() {
        assert_eq!(parse_timestamp("not a timestamp"), None);
        assert_eq!(parse_timestamp("Execute Anonymous: x"), None);
        assert_eq!(parse_timestamp("16:55:57.42 42826462"), None);
    }

    #[test]
    fn parses_entry_with_params() {
        let e = parse_entry("16:55:57.42 (43230894)|USER_DEBUG|[1]|DEBUG|hello").unwrap();
        assert_eq!(e.nanos, 43230894);
        assert_eq!(e.event, LogEvent::UserDebug);
        assert_eq!(e.params, vec!["[1]", "DEBUG", "hello"]);
    }

    #[test]
    fn parses_entry_without_params() {
        let e = parse_entry("16:55:57.42 (42845776)|EXECUTION_STARTED").unwrap();
        assert_eq!(e.event, LogEvent::ExecutionStarted);
        assert!(e.params.is_empty());
    }

    #[test]
    fn non_entry_lines_return_none() {
        assert!(parse_entry("  Number of SOQL queries: 1 out of 100").is_none());
        assert!(parse_entry("Execute Anonymous: System.debug('x');").is_none());
        assert!(parse_entry("").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser entry::`
Expected: FAIL — `parse_entry` / `LogEntry` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/entry.rs` (above the test module):

```rust
use crate::event::LogEvent;

/// One parsed log line: `timestamp | event | params...`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEntry {
    pub timestamp: String,
    pub nanos: u64,
    pub event: LogEvent,
    pub params: Vec<String>,
}

/// Parse `HH:MM:SS.frac (nanos)` and return the nanos value, or None if the
/// string is not a valid log timestamp.
pub fn parse_timestamp(s: &str) -> Option<u64> {
    let (time, paren) = s.split_once(' ')?;
    let mut colons = time.split(':');
    let h = colons.next()?;
    let m = colons.next()?;
    let rest = colons.next()?;
    if colons.next().is_some() {
        return None;
    }
    let (sec, frac) = rest.split_once('.')?;
    if !(all_digits(h) && all_digits(m) && all_digits(sec) && all_digits(frac)) {
        return None;
    }
    let inner = paren.strip_prefix('(')?.strip_suffix(')')?;
    if !all_digits(inner) {
        return None;
    }
    inner.parse::<u64>().ok()
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_event_name(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Parse a single log line into a `LogEntry`, or None if it is not a valid
/// timestamped entry (e.g. a continuation line or the source preamble).
pub fn parse_entry(line: &str) -> Option<LogEntry> {
    let mut parts = line.split('|');
    let ts = parts.next()?;
    let ev = parts.next()?;
    let nanos = parse_timestamp(ts)?;
    if !is_event_name(ev) {
        return None;
    }
    let params: Vec<String> = parts.map(|s| s.to_string()).collect();
    Some(LogEntry {
        timestamp: ts.to_string(),
        nanos,
        event: LogEvent::from_name(ev),
        params,
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p log-parser entry::`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/log-parser/src/entry.rs
git commit -m "feat(log-parser): parse a log line into a LogEntry"
```

---

### Task 5: parse module (whole log → flat units)

**Files:**
- Modify: `crates/log-parser/src/parse.rs`
- Create: `crates/log-parser/tests/golden.rs`

**Interfaces:**
- Consumes: `parse_entry`/`LogEntry` from `crate::entry`, `LogEvent` from `crate::event`, `LogHeader` from `crate::header`.
- Produces: `struct ExecUnit { entries: Vec<LogEntry> }`, `struct ParsedLog { header: Option<LogHeader>, units: Vec<ExecUnit> }`, `ParsedLog::parse(&str) -> ParsedLog`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/parse.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::LogEvent;

    #[test]
    fn appends_continuation_to_previous_entry() {
        let text = "67.0 APEX_CODE,DEBUG\n\
            16:55:57.42 (1)|LIMIT_USAGE_FOR_NS|(default)|\n\
            \x20\x20Number of SOQL queries: 1 out of 100\n";
        let log = ParsedLog::parse(text);
        let entry = &log.units[0].entries[0];
        assert_eq!(entry.event, LogEvent::LimitUsageForNs);
        // namespace param plus the appended continuation line
        assert!(entry.params.iter().any(|p| p.contains("Number of SOQL queries")));
    }

    #[test]
    fn splits_units_on_execution_boundaries() {
        let text = "67.0 X,Y\n\
            16:55:57.42 (1)|EXECUTION_STARTED\n\
            16:55:57.42 (2)|USER_DEBUG|x\n\
            16:55:57.42 (3)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        assert_eq!(log.units.len(), 1);
        assert_eq!(log.units[0].entries.len(), 3);
        assert_eq!(log.units[0].entries[0].event, LogEvent::ExecutionStarted);
    }

    #[test]
    fn drops_preamble_before_first_entry() {
        // "Execute Anonymous:" lines before any entry have no prior entry to
        // attach to and must be dropped, not crash.
        let text = "67.0 X,Y\nExecute Anonymous: foo;\n16:55:57.42 (1)|EXECUTION_STARTED\n";
        let log = ParsedLog::parse(text);
        assert_eq!(log.units.len(), 1);
        assert_eq!(log.units[0].entries.len(), 1);
    }

    #[test]
    fn captures_header() {
        let log = ParsedLog::parse("67.0 APEX_CODE,DEBUG\n16:55:57.42 (1)|EXECUTION_STARTED\n");
        assert_eq!(log.header.unwrap().api_version, "67.0");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser parse::`
Expected: FAIL — `ParsedLog` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/parse.rs` (above the test module):

```rust
use crate::entry::{parse_entry, LogEntry};
use crate::event::LogEvent;
use crate::header::LogHeader;

/// A single execution unit (EXECUTION_STARTED … EXECUTION_FINISHED), flat.
#[derive(Debug, Clone)]
pub struct ExecUnit {
    pub entries: Vec<LogEntry>,
}

/// A fully parsed debug log: header plus flat execution units.
#[derive(Debug, Clone)]
pub struct ParsedLog {
    pub header: Option<LogHeader>,
    pub units: Vec<ExecUnit>,
}

impl ParsedLog {
    pub fn parse(text: &str) -> ParsedLog {
        let mut lines = text.lines();
        let header = lines.next().and_then(LogHeader::parse);
        let mut units: Vec<ExecUnit> = Vec::new();
        let mut current: Option<ExecUnit> = None;

        for line in lines {
            let line = line.trim_end();
            if let Some(entry) = parse_entry(line) {
                match entry.event {
                    LogEvent::ExecutionStarted => {
                        if let Some(u) = current.take() {
                            units.push(u);
                        }
                        current = Some(ExecUnit { entries: vec![entry] });
                    }
                    LogEvent::ExecutionFinished => {
                        let mut u = current
                            .take()
                            .unwrap_or_else(|| ExecUnit { entries: Vec::new() });
                        u.entries.push(entry);
                        units.push(u);
                    }
                    _ => {
                        current
                            .get_or_insert_with(|| ExecUnit { entries: Vec::new() })
                            .entries
                            .push(entry);
                    }
                }
            } else if let Some(u) = current.as_mut() {
                if let Some(last) = u.entries.last_mut() {
                    last.params.push(line.to_string());
                }
            }
        }
        if let Some(u) = current.take() {
            units.push(u);
        }
        units.retain(|u| !u.entries.is_empty());
        ParsedLog { header, units }
    }
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `cargo test -p log-parser parse::`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the golden integration test**

`crates/log-parser/tests/golden.rs`:

```rust
use log_parser::event::LogEvent;
use log_parser::parse::ParsedLog;

const LOG: &str = include_str!("fixtures/anon_apex.log");

#[test]
fn golden_log_parses_header_and_units() {
    let log = ParsedLog::parse(LOG);
    assert_eq!(log.header.as_ref().unwrap().api_version, "67.0");
    // unit 0 = leading USER_INFO; unit 1 = the EXECUTION_STARTED..FINISHED block
    assert_eq!(log.units.len(), 2);
    let exec = &log.units[1];
    assert_eq!(exec.entries.first().unwrap().event, LogEvent::ExecutionStarted);
    assert_eq!(exec.entries.last().unwrap().event, LogEvent::ExecutionFinished);
}
```

- [ ] **Step 6: Run the golden test**

Run: `cargo test -p log-parser --test golden`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add crates/log-parser/src/parse.rs crates/log-parser/tests/golden.rs
git commit -m "feat(log-parser): parse whole log into flat execution units"
```

---

### Task 6: tree module (nested execution tree)

**Files:**
- Modify: `crates/log-parser/src/tree.rs`
- Modify: `crates/log-parser/tests/golden.rs`

**Interfaces:**
- Consumes: `LogEntry` from `crate::entry`, `ScopeKind` from `crate::event`, `ExecUnit` from `crate::parse`.
- Produces: `struct ExecNode { entry: LogEntry, children: Vec<ExecNode>, dur_ns: Option<u64> }`, `build_tree(&ExecUnit) -> Vec<ExecNode>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/tree.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    #[test]
    fn nests_scopes_and_computes_duration() {
        let text = "67.0 X,Y\n\
            16:55:57.42 (10)|EXECUTION_STARTED\n\
            16:55:57.42 (20)|CODE_UNIT_STARTED|x\n\
            16:55:57.42 (30)|USER_DEBUG|hi\n\
            16:55:57.42 (40)|CODE_UNIT_FINISHED|x\n\
            16:55:57.42 (50)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].dur_ns, Some(40)); // 50 - 10
        assert_eq!(roots[0].children.len(), 1); // CODE_UNIT
        assert_eq!(roots[0].children[0].dur_ns, Some(20)); // 40 - 20
        assert_eq!(roots[0].children[0].children.len(), 1); // USER_DEBUG leaf
    }

    #[test]
    fn unmatched_end_becomes_root_leaf() {
        let text = "67.0 X,Y\n16:55:57.42 (10)|CODE_UNIT_FINISHED|x\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        assert_eq!(roots.len(), 1);
        assert!(roots[0].children.is_empty());
        assert_eq!(roots[0].dur_ns, None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser tree::`
Expected: FAIL — `build_tree` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/tree.rs` (above the test module):

```rust
use crate::entry::LogEntry;
use crate::event::ScopeKind;
use crate::parse::ExecUnit;

/// A node in the nested execution tree.
#[derive(Debug, Clone)]
pub struct ExecNode {
    pub entry: LogEntry,
    pub children: Vec<ExecNode>,
    pub dur_ns: Option<u64>,
}

/// Build a nested tree from a flat unit by pairing scope start/end events.
pub fn build_tree(unit: &ExecUnit) -> Vec<ExecNode> {
    let mut roots: Vec<ExecNode> = Vec::new();
    let mut stack: Vec<ExecNode> = Vec::new();

    for entry in &unit.entries {
        match entry.event.scope_kind() {
            ScopeKind::Start => {
                stack.push(ExecNode {
                    entry: entry.clone(),
                    children: Vec::new(),
                    dur_ns: None,
                });
            }
            ScopeKind::End => {
                if let Some(mut node) = stack.pop() {
                    node.dur_ns = Some(entry.nanos.saturating_sub(node.entry.nanos));
                    attach(&mut roots, &mut stack, node);
                } else {
                    attach(
                        &mut roots,
                        &mut stack,
                        ExecNode {
                            entry: entry.clone(),
                            children: Vec::new(),
                            dur_ns: None,
                        },
                    );
                }
            }
            ScopeKind::Leaf => {
                attach(
                    &mut roots,
                    &mut stack,
                    ExecNode {
                        entry: entry.clone(),
                        children: Vec::new(),
                        dur_ns: None,
                    },
                );
            }
        }
    }
    // Flush any unclosed scopes, deepest first, into their parents/roots.
    while let Some(node) = stack.pop() {
        attach(&mut roots, &mut stack, node);
    }
    roots
}

fn attach(roots: &mut Vec<ExecNode>, stack: &mut [ExecNode], node: ExecNode) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p log-parser tree::`
Expected: PASS (2 tests).

- [ ] **Step 5: Extend the golden test with tree assertions**

Append to `crates/log-parser/tests/golden.rs`:

```rust
#[test]
fn golden_log_builds_expected_tree() {
    use log_parser::tree::build_tree;
    let log = ParsedLog::parse(LOG);
    let roots = build_tree(&log.units[1]);
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].entry.event, LogEvent::ExecutionStarted);
    // EXECUTION -> CODE_UNIT
    let code_unit = &roots[0].children[0];
    assert_eq!(code_unit.entry.event, LogEvent::CodeUnitStarted);
    // CODE_UNIT contains the two USER_DEBUG leaves and the limit-usage scope
    assert!(code_unit
        .children
        .iter()
        .any(|c| c.entry.event == LogEvent::UserDebug));
    assert!(code_unit
        .children
        .iter()
        .any(|c| c.entry.event == LogEvent::CumulativeLimitUsage));
}
```

- [ ] **Step 6: Run the golden test**

Run: `cargo test -p log-parser --test golden`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add crates/log-parser/src/tree.rs crates/log-parser/tests/golden.rs
git commit -m "feat(log-parser): build nested execution tree from scope pairs"
```

---

### Task 7: limits module (governor-limit rollup)

**Files:**
- Modify: `crates/log-parser/src/limits.rs`
- Modify: `crates/log-parser/tests/golden.rs`

**Interfaces:**
- Consumes: `LogEvent` from `crate::event`, `ExecUnit` from `crate::parse`.
- Produces: `struct LimitEntry { name: String, used: u64, max: u64 }`, `struct LimitRollup { namespace: String, entries: Vec<LimitEntry> }`, `extract_limits(&ExecUnit) -> Vec<LimitRollup>`.

- [ ] **Step 1: Write the failing test**

Append to `crates/log-parser/src/limits.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    #[test]
    fn extracts_limit_entries_from_continuation_lines() {
        let text = "67.0 X,Y\n\
            16:55:57.42 (1)|LIMIT_USAGE_FOR_NS|(default)|\n\
            \x20\x20Number of SOQL queries: 2 out of 100\n\
            \x20\x20Maximum CPU time: 50 out of 10000\n";
        let log = ParsedLog::parse(text);
        let rollups = extract_limits(&log.units[0]);
        assert_eq!(rollups.len(), 1);
        assert_eq!(rollups[0].namespace, "(default)");
        assert_eq!(
            rollups[0].entries[0],
            LimitEntry { name: "Number of SOQL queries".to_string(), used: 2, max: 100 }
        );
        assert_eq!(
            rollups[0].entries[1],
            LimitEntry { name: "Maximum CPU time".to_string(), used: 50, max: 10000 }
        );
    }

    #[test]
    fn ignores_non_limit_params() {
        // The namespace param "(default)" and blank lines are not limit lines.
        let text = "67.0 X,Y\n16:55:57.42 (1)|LIMIT_USAGE_FOR_NS|(default)|\n";
        let log = ParsedLog::parse(text);
        assert!(extract_limits(&log.units[0]).is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p log-parser limits::`
Expected: FAIL — `extract_limits` not found.

- [ ] **Step 3: Write minimal implementation**

Prepend to `crates/log-parser/src/limits.rs` (above the test module):

```rust
use crate::event::LogEvent;
use crate::parse::ExecUnit;

/// One governor limit reading: `<name>: <used> out of <max>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitEntry {
    pub name: String,
    pub used: u64,
    pub max: u64,
}

/// All limit readings for one namespace (`LIMIT_USAGE_FOR_NS` block).
#[derive(Debug, Clone)]
pub struct LimitRollup {
    pub namespace: String,
    pub entries: Vec<LimitEntry>,
}

/// Extract governor-limit rollups from a unit. The limit numbers live as
/// continuation params on each `LIMIT_USAGE_FOR_NS` entry.
pub fn extract_limits(unit: &ExecUnit) -> Vec<LimitRollup> {
    let mut rollups = Vec::new();
    for entry in &unit.entries {
        if entry.event != LogEvent::LimitUsageForNs {
            continue;
        }
        let namespace = entry.params.first().cloned().unwrap_or_default();
        let entries: Vec<LimitEntry> = entry.params.iter().filter_map(|p| parse_limit_line(p)).collect();
        if !entries.is_empty() {
            rollups.push(LimitRollup { namespace, entries });
        }
    }
    rollups
}

/// Parse `  Number of SOQL queries: 1 out of 100` into a `LimitEntry`.
fn parse_limit_line(line: &str) -> Option<LimitEntry> {
    let line = line.trim();
    let (name, rest) = line.split_once(':')?;
    let (used_s, max_s) = rest.trim().split_once(" out of ")?;
    let used = used_s.trim().parse::<u64>().ok()?;
    let max = max_s.trim().parse::<u64>().ok()?;
    Some(LimitEntry {
        name: name.trim().to_string(),
        used,
        max,
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p log-parser limits::`
Expected: PASS (2 tests).

- [ ] **Step 5: Extend the golden test with limit assertions**

Append to `crates/log-parser/tests/golden.rs`:

```rust
#[test]
fn golden_log_extracts_limits() {
    use log_parser::limits::{extract_limits, LimitEntry};
    let log = ParsedLog::parse(LOG);
    let rollups = extract_limits(&log.units[1]);
    assert_eq!(rollups.len(), 1);
    assert_eq!(rollups[0].namespace, "(default)");
    let e = &rollups[0].entries;
    assert!(e.contains(&LimitEntry { name: "Number of SOQL queries".to_string(), used: 1, max: 100 }));
    assert!(e.contains(&LimitEntry { name: "Maximum CPU time".to_string(), used: 0, max: 10000 }));
    assert!(e.contains(&LimitEntry { name: "Maximum heap size".to_string(), used: 0, max: 6000000 }));
}
```

- [ ] **Step 6: Full verification and commit**

Run: `cargo test -p log-parser && cargo clippy -p log-parser -- -D warnings`
Expected: all tests PASS (event 4, header 2, entry 5, parse 4, tree 2, limits 2, golden 3 = 22); clippy clean.

```bash
git add crates/log-parser/src/limits.rs crates/log-parser/tests/golden.rs
git commit -m "feat(log-parser): extract governor-limit rollups"
```

---

## Self-Review

- **Spec coverage:** every module in the spec has a task — `event` (T2), `header` (T3), `entry` (T4), `parse`/`ParsedLog`/`ExecUnit` (T5), `tree`/`ExecNode` (T6), `limits` (T7); golden fixture + end-to-end assertions (T1/T5/T6/T7). Deferred items (hotspot, category/level table) correctly absent.
- **Placeholder scan:** every step has complete code and exact commands; no TBD.
- **Type consistency:** `LogEvent`/`ScopeKind` (T2) used by `entry` (T4), `parse` (T5), `tree` (T6), `limits` (T7); `LogEntry` fields (`timestamp,nanos,event,params`) consistent across T4–T7; `ExecUnit`/`ParsedLog` (T5) consumed by `build_tree`/`extract_limits` with matching signatures; golden test uses `log_parser::{event,parse,tree,limits}` module paths matching lib.rs.
