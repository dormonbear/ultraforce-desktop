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
