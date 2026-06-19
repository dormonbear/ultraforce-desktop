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
