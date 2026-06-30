//! Resolve each log entry to the Apex source it executed: a class name (carried
//! down the call stack) plus the `[N]` line number on the entry itself.

use crate::entry::LogEntry;
use crate::event::ScopeKind;

/// A class + (optional) line an entry maps to in Apex source. `line` is `None`
/// for entries that name a class but carry no `[N]` (e.g. `CODE_UNIT_STARTED`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRef {
    pub class_name: String,
    pub line: Option<u32>,
}

fn is_ident(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// Pull the `[N]` source line from an entry's params (`[12]` → `12`). Brackets
/// without a number (`[EXTERNAL]`) or no brackets yield `None`.
pub fn extract_line(params: &[String]) -> Option<u32> {
    for p in params {
        let b = p.as_bytes();
        for i in 0..b.len() {
            if b[i] != b'[' {
                continue;
            }
            let start = i + 1;
            let mut j = start;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > start && j < b.len() && b[j] == b']' {
                return p[start..j].parse().ok();
            }
        }
    }
    None
}

/// Pull the class from a `Class.method(` shape in the params, matching the
/// frontend's rule: `ns.MyClass.doWork()` → `MyClass`. No such shape → `None`.
pub fn extract_class(params: &[String]) -> Option<String> {
    params.iter().find_map(|p| class_in(p))
}

/// Find the first `Ident.ident(` in `s` and return the left `Ident`.
fn class_in(s: &str) -> Option<String> {
    let b = s.as_bytes();
    for i in 0..b.len() {
        if b[i] != b'.' {
            continue;
        }
        // Right of the dot: an identifier (the method), optional spaces, then `(`.
        let mut j = i + 1;
        while j < b.len() && is_ident(b[j]) {
            j += 1;
        }
        let method_end = j;
        while j < b.len() && b[j] == b' ' {
            j += 1;
        }
        if method_end == i + 1 || j >= b.len() || b[j] != b'(' {
            continue;
        }
        // Left of the dot: the class identifier, must start with a non-digit.
        let mut k = i;
        while k > 0 && is_ident(b[k - 1]) {
            k -= 1;
        }
        if k < i && (b[k].is_ascii_alphabetic() || b[k] == b'_') {
            return Some(s[k..i].to_string());
        }
    }
    None
}

/// For each entry (in order), the source it maps to: own class if it names one,
/// else the nearest enclosing class on the scope stack; line is the entry's own
/// `[N]`. Entries with no class context resolve to `None`.
pub fn resolve_sources(entries: &[LogEntry]) -> Vec<Option<SourceRef>> {
    let mut out = Vec::with_capacity(entries.len());
    // One slot per open scope; holds the class that scope introduced, if any.
    let mut stack: Vec<Option<String>> = Vec::new();
    for entry in entries {
        let line = extract_line(&entry.params);
        // Only method/constructor/code-unit events name a class. Data events
        // (USER_DEBUG, EXCEPTION_THROWN, SOQL, …) carry free text whose stray
        // `X.method(` must not be mistaken for source — they inherit the class.
        let own = if entry.event.names_class() {
            extract_class(&entry.params)
        } else {
            None
        };
        let class = own
            .clone()
            .or_else(|| stack.iter().rev().flatten().next().cloned());
        out.push(class.map(|class_name| SourceRef { class_name, line }));
        match entry.event.scope_kind() {
            ScopeKind::Start => stack.push(own),
            ScopeKind::End => {
                stack.pop();
            }
            ScopeKind::Leaf => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    fn sources_for(text: &str) -> Vec<Option<SourceRef>> {
        let log = ParsedLog::parse(text);
        resolve_sources(&log.units[0].entries)
    }

    fn p(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn extracts_bracket_line() {
        assert_eq!(extract_line(&p(&["[12]", "x"])), Some(12));
        assert_eq!(extract_line(&p(&["[EXTERNAL]"])), None);
        assert_eq!(extract_line(&p(&["no bracket"])), None);
    }

    #[test]
    fn extracts_class_from_qualified_call() {
        assert_eq!(extract_class(&p(&["MyClass.doWork()"])).as_deref(), Some("MyClass"));
        assert_eq!(
            extract_class(&p(&["[12]", "01p", "ns.MyClass.doWork()"])).as_deref(),
            Some("MyClass")
        );
        assert_eq!(extract_class(&p(&["<init>()"])), None);
        assert_eq!(extract_class(&p(&["plain text"])), None);
    }

    #[test]
    fn statement_inherits_enclosing_method_class() {
        let text = "67.0 X\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n\
            16:00:00.0 (30)|USER_DEBUG|[8]|DEBUG|hi\n\
            16:00:00.0 (40)|METHOD_EXIT|[5]|MyClass.doWork()\n\
            16:00:00.0 (50)|EXECUTION_FINISHED\n";
        let s = sources_for(text);
        assert_eq!(s[0], None); // EXECUTION_STARTED: no class
        assert_eq!(
            s[1],
            Some(SourceRef { class_name: "MyClass".into(), line: Some(5) })
        );
        // USER_DEBUG inherits the enclosing class, keeps its own line.
        assert_eq!(
            s[2],
            Some(SourceRef { class_name: "MyClass".into(), line: Some(8) })
        );
    }

    #[test]
    fn nested_scopes_track_innermost_class() {
        let text = "67.0 X\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (20)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Outer.run()\n\
            16:00:00.0 (25)|USER_DEBUG|[3]|DEBUG|in-outer\n\
            16:00:00.0 (30)|METHOD_ENTRY|[5]|01p|Inner.work()\n\
            16:00:00.0 (35)|USER_DEBUG|[9]|DEBUG|in-inner\n\
            16:00:00.0 (40)|METHOD_EXIT|[5]|Inner.work()\n\
            16:00:00.0 (45)|USER_DEBUG|[4]|DEBUG|back-outer\n\
            16:00:00.0 (50)|CODE_UNIT_FINISHED|Outer.run()\n\
            16:00:00.0 (55)|EXECUTION_FINISHED\n";
        let s = sources_for(text);
        assert_eq!(s[1].as_ref().unwrap().class_name, "Outer"); // code unit, line None
        assert_eq!(
            s[2],
            Some(SourceRef { class_name: "Outer".into(), line: Some(3) })
        );
        assert_eq!(
            s[4],
            Some(SourceRef { class_name: "Inner".into(), line: Some(9) })
        );
        // After Inner exits, debug is back under Outer.
        assert_eq!(
            s[6],
            Some(SourceRef { class_name: "Outer".into(), line: Some(4) })
        );
    }

    #[test]
    fn data_event_message_is_not_parsed_as_a_class() {
        // A USER_DEBUG message that happens to contain `X.method(` must not be
        // mistaken for Apex source: the event names no class of its own, and
        // there's no enclosing user class here, so it resolves to None.
        let text = "67.0 X\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (20)|USER_DEBUG|[144]|DEBUG|type is SObject.getSObjectType()\n\
            16:00:00.0 (30)|EXECUTION_FINISHED\n";
        let s = sources_for(text);
        assert_eq!(s[1], None);
    }

    #[test]
    fn data_event_inherits_enclosing_class_not_its_message() {
        // Inside a real method, a debug line with a stray `X.method(` resolves to
        // the enclosing class (with its own line), never the text's "SObject".
        let text = "67.0 X\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (20)|METHOD_ENTRY|[5]|01p|MyClass.run()\n\
            16:00:00.0 (25)|USER_DEBUG|[144]|DEBUG|got SObject.getSObjectType()\n\
            16:00:00.0 (30)|METHOD_EXIT|[5]|MyClass.run()\n\
            16:00:00.0 (35)|EXECUTION_FINISHED\n";
        let s = sources_for(text);
        assert_eq!(
            s[2],
            Some(SourceRef { class_name: "MyClass".into(), line: Some(144) })
        );
    }

    #[test]
    fn no_class_context_yields_none() {
        let text = "67.0 X\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (20)|USER_DEBUG|[2]|DEBUG|orphan\n\
            16:00:00.0 (30)|EXECUTION_FINISHED\n";
        let s = sources_for(text);
        assert_eq!(s[1], None);
    }
}
