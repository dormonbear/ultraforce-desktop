//! Extract thrown exceptions and fatal errors from an execution unit. These are
//! point events (no scope), so they don't appear in the execution tree — the
//! analyser surfaces them separately.

use crate::event::LogEvent;
use crate::parse::ExecUnit;

/// One `EXCEPTION_THROWN` or `FATAL_ERROR` occurrence.
#[derive(Debug, Clone, PartialEq)]
pub struct ApexException {
    /// "EXCEPTION_THROWN" or "FATAL_ERROR".
    pub kind: String,
    /// The event's params joined — type, message, and (for fatal errors) the
    /// stack trace.
    pub message: String,
}

/// Exceptions and fatal errors in this unit, in order of occurrence.
pub fn exceptions(unit: &ExecUnit) -> Vec<ApexException> {
    unit.entries
        .iter()
        .filter_map(|e| {
            let kind = match e.event {
                LogEvent::FatalError => "FATAL_ERROR",
                LogEvent::ExceptionThrown => "EXCEPTION_THROWN",
                _ => return None,
            };
            Some(ApexException {
                kind: kind.to_string(),
                message: e.params.join(" | "),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    #[test]
    fn extracts_exceptions_and_fatal_errors_in_order() {
        let raw = "\
12:00:00.0 (1)|EXECUTION_STARTED
12:00:00.1 (2)|EXCEPTION_THROWN|[12]|System.NullPointerException: bad
12:00:00.2 (3)|FATAL_ERROR|System.LimitException: Too many SOQL queries: 101
12:00:00.3 (4)|EXECUTION_FINISHED";
        let parsed = ParsedLog::parse(raw);
        let ex = exceptions(&parsed.units[0]);
        assert_eq!(ex.len(), 2);
        assert_eq!(ex[0].kind, "EXCEPTION_THROWN");
        assert!(ex[0].message.contains("NullPointerException"));
        assert_eq!(ex[1].kind, "FATAL_ERROR");
        assert!(ex[1].message.contains("Too many SOQL"));
    }
}
