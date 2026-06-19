//! Configure anonymous-Apex debug verbosity via Tooling DebugLevel + TraceFlag.

/// A Salesforce debug-log level. `as_sf`/`from_sf` bridge to sf strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    None,
    Error,
    Warn,
    Info,
    Fine,
    Finer,
    Finest,
    Debug,
}

impl LogLevel {
    pub fn as_sf(self) -> &'static str {
        match self {
            LogLevel::None => "NONE",
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Fine => "FINE",
            LogLevel::Finer => "FINER",
            LogLevel::Finest => "FINEST",
            LogLevel::Debug => "DEBUG",
        }
    }
    pub fn from_sf(s: &str) -> LogLevel {
        match s {
            "ERROR" => LogLevel::Error,
            "WARN" => LogLevel::Warn,
            "INFO" => LogLevel::Info,
            "FINE" => LogLevel::Fine,
            "FINER" => LogLevel::Finer,
            "FINEST" => LogLevel::Finest,
            "DEBUG" => LogLevel::Debug,
            _ => LogLevel::None,
        }
    }
}

/// The eleven DebugLevel category levels (Tooling field name in the comment).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CategoryLevels {
    pub apex_code: LogLevel,      // ApexCode
    pub apex_profiling: LogLevel, // ApexProfiling
    pub callout: LogLevel,        // Callout
    pub data_access: LogLevel,    // DataAccess
    pub database: LogLevel,       // Database
    pub nba: LogLevel,            // Nba
    pub system: LogLevel,         // System
    pub validation: LogLevel,     // Validation
    pub visualforce: LogLevel,    // Visualforce
    pub wave: LogLevel,           // Wave
    pub workflow: LogLevel,       // Workflow
}

impl CategoryLevels {
    /// Space-separated `Field=LEVEL` pairs for `sf data ... -v`.
    pub fn values_arg(&self) -> String {
        [
            ("ApexCode", self.apex_code),
            ("ApexProfiling", self.apex_profiling),
            ("Callout", self.callout),
            ("DataAccess", self.data_access),
            ("Database", self.database),
            ("Nba", self.nba),
            ("System", self.system),
            ("Validation", self.validation),
            ("Visualforce", self.visualforce),
            ("Wave", self.wave),
            ("Workflow", self.workflow),
        ]
        .iter()
        .map(|(f, l)| format!("{f}={}", l.as_sf()))
        .collect::<Vec<_>>()
        .join(" ")
    }
}

/// A predefined verbosity preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preset {
    None,
    ApexOnly,
    FullDebugging,
}

const ALL_NONE: CategoryLevels = CategoryLevels {
    apex_code: LogLevel::None,
    apex_profiling: LogLevel::None,
    callout: LogLevel::None,
    data_access: LogLevel::None,
    database: LogLevel::None,
    nba: LogLevel::None,
    system: LogLevel::None,
    validation: LogLevel::None,
    visualforce: LogLevel::None,
    wave: LogLevel::None,
    workflow: LogLevel::None,
};

/// Pure: a preset → its category map (single source of truth, mirrored in TS).
pub fn preset_levels(p: Preset) -> CategoryLevels {
    match p {
        Preset::None => ALL_NONE,
        Preset::ApexOnly => CategoryLevels {
            apex_code: LogLevel::Debug,
            system: LogLevel::Debug,
            ..ALL_NONE
        },
        Preset::FullDebugging => CategoryLevels {
            apex_code: LogLevel::Finest,
            apex_profiling: LogLevel::Finest,
            callout: LogLevel::Finest,
            data_access: LogLevel::Finest,
            database: LogLevel::Finest,
            nba: LogLevel::Fine,
            system: LogLevel::Fine,
            validation: LogLevel::Info,
            visualforce: LogLevel::Finer,
            wave: LogLevel::Finer,
            workflow: LogLevel::Finer,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_none_is_all_none() {
        let l = preset_levels(Preset::None);
        assert_eq!(l.apex_code, LogLevel::None);
        assert_eq!(l.workflow, LogLevel::None);
    }

    #[test]
    fn preset_apex_only_sets_apex_and_system() {
        let l = preset_levels(Preset::ApexOnly);
        assert_eq!(l.apex_code, LogLevel::Debug);
        assert_eq!(l.system, LogLevel::Debug);
        assert_eq!(l.database, LogLevel::None);
    }

    #[test]
    fn preset_full_debugging_matches_ic2_debug_map() {
        let l = preset_levels(Preset::FullDebugging);
        assert_eq!(l.apex_code, LogLevel::Finest);
        assert_eq!(l.system, LogLevel::Fine);
        assert_eq!(l.validation, LogLevel::Info);
    }

    #[test]
    fn values_arg_uses_tooling_field_names() {
        let arg = preset_levels(Preset::ApexOnly).values_arg();
        assert!(arg.contains("ApexCode=DEBUG"), "got: {arg}");
        assert!(arg.contains("System=DEBUG"), "got: {arg}");
        assert!(arg.contains("Workflow=NONE"), "got: {arg}");
    }
}
