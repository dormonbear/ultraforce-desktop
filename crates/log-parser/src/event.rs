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
    HeapAllocate,
    VariableScopeBegin,
    VariableAssignment,
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
            "HEAP_ALLOCATE" => LogEvent::HeapAllocate,
            "VARIABLE_SCOPE_BEGIN" => LogEvent::VariableScopeBegin,
            "VARIABLE_ASSIGNMENT" => LogEvent::VariableAssignment,
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
            ExecutionFinished
            | CodeUnitFinished
            | MethodExit
            | ConstructorExit
            | SoqlExecuteEnd
            | DmlEnd
            | CumulativeLimitUsageEnd => ScopeKind::End,
            Other(name) => scope_kind_by_suffix(name),
            _ => ScopeKind::Leaf,
        }
    }

    /// Whether this event carries an Apex `Class.method()` / `Class.<init>()`
    /// signature in its params, so a class name can be extracted from it. Data
    /// events (e.g. `USER_DEBUG`) carry free text that must NOT be parsed as a
    /// class — their source class is inherited from the enclosing scope instead.
    pub fn names_class(&self) -> bool {
        use LogEvent::*;
        matches!(
            self,
            CodeUnitStarted
                | CodeUnitFinished
                | MethodEntry
                | MethodExit
                | ConstructorEntry
                | ConstructorExit
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_event_names() {
        assert_eq!(
            LogEvent::from_name("EXECUTION_STARTED"),
            LogEvent::ExecutionStarted
        );
        assert_eq!(LogEvent::from_name("USER_DEBUG"), LogEvent::UserDebug);
        assert_eq!(
            LogEvent::from_name("LIMIT_USAGE_FOR_NS"),
            LogEvent::LimitUsageForNs
        );
    }

    #[test]
    fn maps_variable_events() {
        assert_eq!(
            LogEvent::from_name("VARIABLE_SCOPE_BEGIN"),
            LogEvent::VariableScopeBegin
        );
        assert_eq!(
            LogEvent::from_name("VARIABLE_ASSIGNMENT"),
            LogEvent::VariableAssignment
        );
    }

    #[test]
    fn variable_events_are_leaves() {
        assert_eq!(LogEvent::VariableScopeBegin.scope_kind(), ScopeKind::Leaf);
        assert_eq!(LogEvent::VariableAssignment.scope_kind(), ScopeKind::Leaf);
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
        assert_eq!(
            LogEvent::from_name("FLOW_X_BEGIN").scope_kind(),
            ScopeKind::Start
        );
        assert_eq!(
            LogEvent::from_name("FLOW_X_END").scope_kind(),
            ScopeKind::End
        );
        assert_eq!(
            LogEvent::from_name("SOME_DETAIL").scope_kind(),
            ScopeKind::Leaf
        );
    }
}
