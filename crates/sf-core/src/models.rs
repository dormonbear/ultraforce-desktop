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

/// Result of `sf apex run --json`. Includes the debug log inline.
#[derive(Debug, Clone, Deserialize)]
pub struct ApexRunResult {
    pub success: bool,
    pub compiled: bool,
    #[serde(rename = "compileProblem", default)]
    pub compile_problem: String,
    #[serde(rename = "exceptionMessage", default)]
    pub exception_message: String,
    #[serde(rename = "exceptionStackTrace", default)]
    pub exception_stack_trace: String,
    #[serde(default)]
    pub line: i64,
    #[serde(default)]
    pub column: i64,
    #[serde(default)]
    pub logs: String,
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
    fn deserializes_apex_run_result_with_logs() {
        let json = r#"{"success":true,"compiled":true,"compileProblem":"",
            "exceptionMessage":"","exceptionStackTrace":"","line":-1,"column":-1,
            "logs":"45.0 APEX_CODE,DEBUG\nExecute Anonymous: x"}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(r.success && r.compiled);
        assert_eq!(r.line, -1);
        assert!(r.logs.contains("Execute Anonymous"));
    }

    #[test]
    fn deserializes_apex_run_compile_failure() {
        let json = r#"{"success":false,"compiled":false,
            "compileProblem":"Unexpected token","exceptionMessage":"",
            "exceptionStackTrace":"","line":3,"column":10,"logs":""}"#;
        let r: ApexRunResult = serde_json::from_str(json).unwrap();
        assert!(!r.compiled);
        assert_eq!(r.compile_problem, "Unexpected token");
        assert_eq!((r.line, r.column), (3, 10));
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
