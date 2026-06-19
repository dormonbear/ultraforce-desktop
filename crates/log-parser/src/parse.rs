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
                        current = Some(ExecUnit {
                            entries: vec![entry],
                        });
                    }
                    LogEvent::ExecutionFinished => {
                        let mut u = current.take().unwrap_or_else(|| ExecUnit {
                            entries: Vec::new(),
                        });
                        u.entries.push(entry);
                        units.push(u);
                    }
                    _ => {
                        current
                            .get_or_insert_with(|| ExecUnit {
                                entries: Vec::new(),
                            })
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
        assert!(entry
            .params
            .iter()
            .any(|p| p.contains("Number of SOQL queries")));
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
