use serde::Deserialize;

/// Result of `sf data query --json`. Records stay as raw JSON values;
/// per-feature crates map them to typed rows.
#[derive(Debug, Clone, Deserialize)]
pub struct QueryResult {
    pub records: Vec<serde_json::Value>,
    #[serde(rename = "totalSize")]
    pub total_size: i64,
    #[serde(default)]
    pub done: bool,
}

/// One entry from `sf apex list log --json` (PascalCase ApexLog fields).
#[derive(Debug, Clone, Deserialize)]
pub struct ApexLogRef {
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "Operation", default)]
    pub operation: String,
    #[serde(rename = "Status", default)]
    pub status: String,
    #[serde(rename = "StartTime", default)]
    pub start_time: String,
    #[serde(rename = "LogLength", default)]
    pub log_length: i64,
    #[serde(rename = "DurationMilliseconds", default)]
    pub duration_ms: i64,
    #[serde(rename = "Application", default)]
    pub application: String,
    #[serde(rename = "LogUser", default)]
    pub log_user: LogUserRef,
}

/// Nested `LogUser` relationship from `sf apex list log` (just the Name).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct LogUserRef {
    #[serde(rename = "Name", default)]
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_query_result() {
        let json = r#"{"records":[{"Id":"001","Name":"Acme"}],"totalSize":1,"done":true}"#;
        let qr: QueryResult = serde_json::from_str(json).unwrap();
        assert_eq!(qr.total_size, 1);
        assert!(qr.done);
        assert_eq!(qr.records.len(), 1);
        assert_eq!(qr.records[0]["Name"], "Acme");
    }

    #[test]
    fn deserializes_apex_log_ref() {
        let json = r#"{"Id":"07L1","Operation":"/services/data","Status":"Success",
            "StartTime":"2026-06-18T00:00:00.000+0000","LogLength":1234,
            "DurationMilliseconds":56,"Application":"Unknown"}"#;
        let log: ApexLogRef = serde_json::from_str(json).unwrap();
        assert_eq!(log.id, "07L1");
        assert_eq!(log.status, "Success");
        assert_eq!(log.log_length, 1234);
        assert_eq!(log.duration_ms, 56);
    }
}
