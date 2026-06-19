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
        let entries: Vec<LimitEntry> = entry
            .params
            .iter()
            .filter_map(|p| parse_limit_line(p))
            .collect();
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
            LimitEntry {
                name: "Number of SOQL queries".to_string(),
                used: 2,
                max: 100
            }
        );
        assert_eq!(
            rollups[0].entries[1],
            LimitEntry {
                name: "Maximum CPU time".to_string(),
                used: 50,
                max: 10000
            }
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
