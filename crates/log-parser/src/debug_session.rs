//! Build a replayable, IDE-style step-debugging session from execution units.
//!
//! Two-phase / lazy by design so opening a debugger over a large FINEST log is
//! cheap: [`build_outline`] returns just the ordered stop points (no per-step
//! call-stack snapshots), and [`frames_at`] reconstructs the call stack and
//! variables for a single step on demand. Pure and offline — no org, no live
//! debugger.

use crate::entry::LogEntry;
use crate::event::LogEvent;
use crate::parse::ExecUnit;
use crate::source::{resolve_sources, SourceRef};

/// A variable visible in a frame at a step. `value` is the latest assigned value
/// (empty until first assignment); `type_name` comes from `VARIABLE_SCOPE_BEGIN`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VarValue {
    pub name: String,
    pub type_name: Option<String>,
    pub value: String,
}

/// One frame on the call stack at a step: a class, the line currently executing
/// in it, a display signature (`Class.method()`), and its visible variables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub class_name: String,
    pub line: Option<u32>,
    pub signature: String,
    pub variables: Vec<VarValue>,
}

/// One stop point in the replay (lightweight — no call-stack snapshot). Address
/// a step's full state with [`frames_at`] using `unit_index` + `entry_index`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub unit_index: usize,
    pub entry_index: usize,
    pub source: SourceRef,
    pub depth: usize,
    /// True when this stop opens a new call frame (a method / constructor /
    /// code-unit entry) — used for function-level "next/prev function" stepping.
    pub is_frame_start: bool,
}

/// The replay outline: ordered stop points across all units, plus whether the
/// log carries any variable data (so the UI can prompt for FINEST when not).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DebugSession {
    pub steps: Vec<Step>,
    pub has_variables: bool,
}

/// Events that open a call frame (push onto the call stack).
fn opens_frame(ev: &LogEvent) -> bool {
    matches!(
        ev,
        LogEvent::MethodEntry | LogEvent::ConstructorEntry | LogEvent::CodeUnitStarted
    )
}

/// Events that close a call frame (pop the call stack).
fn closes_frame(ev: &LogEvent) -> bool {
    matches!(
        ev,
        LogEvent::MethodExit | LogEvent::ConstructorExit | LogEvent::CodeUnitFinished
    )
}

/// Bookkeeping events that update state but are never stop points.
fn is_bookkeeping(ev: &LogEvent) -> bool {
    matches!(
        ev,
        LogEvent::VariableScopeBegin | LogEvent::VariableAssignment | LogEvent::HeapAllocate
    )
}

/// The `Class.method()` display string from an entry's params, else `None`.
fn signature_of(params: &[String]) -> Option<String> {
    params.iter().find(|p| p.contains('(')).cloned()
}

/// Apply one entry's effect to the call stack (open/close a frame, declare/assign
/// a variable, or advance the current line). Returns whether the entry is a stop
/// point: an executed source line that isn't a frame close or bookkeeping.
fn advance(frames: &mut Vec<Frame>, entry: &LogEntry, src: &Option<SourceRef>) -> bool {
    let ev = &entry.event;
    let line = src.as_ref().and_then(|s| s.line);

    if opens_frame(ev) {
        let class_name = src
            .as_ref()
            .map(|s| s.class_name.clone())
            .unwrap_or_default();
        frames.push(Frame {
            class_name: class_name.clone(),
            line,
            signature: signature_of(&entry.params).unwrap_or(class_name),
            variables: Vec::new(),
        });
    } else if closes_frame(ev) {
        frames.pop();
    } else if *ev == LogEvent::VariableScopeBegin {
        declare_var(frames.last_mut(), &entry.params);
    } else if *ev == LogEvent::VariableAssignment {
        assign_var(frames.last_mut(), &entry.params);
    } else if let (Some(top), Some(l)) = (frames.last_mut(), line) {
        top.line = Some(l);
    }

    line.is_some() && !closes_frame(ev) && !is_bookkeeping(ev)
}

/// Build the lightweight replay outline across all units (each unit replayed
/// with a fresh call stack; stop points concatenated). Cheap to compute and to
/// serialize — no per-step call-stack snapshots.
pub fn build_outline(units: &[ExecUnit]) -> DebugSession {
    let mut steps = Vec::new();
    let mut has_variables = false;

    for (ui, unit) in units.iter().enumerate() {
        let sources = resolve_sources(&unit.entries);
        let mut frames: Vec<Frame> = Vec::new();
        for (i, entry) in unit.entries.iter().enumerate() {
            if entry.event == LogEvent::VariableAssignment {
                has_variables = true;
            }
            if advance(&mut frames, entry, &sources[i]) {
                steps.push(Step {
                    unit_index: ui,
                    entry_index: i,
                    source: sources[i].clone().expect("stop point has a source"),
                    depth: frames.len(),
                    is_frame_start: opens_frame(&entry.event),
                });
            }
        }
    }

    DebugSession {
        steps,
        has_variables,
    }
}

/// Reconstruct the call stack (with variables) at a single stop point by
/// replaying the unit up to and including `entry_index`. O(entry_index) — run
/// on demand as the user steps, not eagerly for every step.
pub fn frames_at(unit: &ExecUnit, entry_index: usize) -> Vec<Frame> {
    let sources = resolve_sources(&unit.entries);
    let mut frames: Vec<Frame> = Vec::new();
    for (i, entry) in unit.entries.iter().enumerate() {
        advance(&mut frames, entry, &sources[i]);
        if i == entry_index {
            break;
        }
    }
    frames
}

/// `VARIABLE_SCOPE_BEGIN|[line]|name|type|...` → declare `name` in the top frame.
fn declare_var(frame: Option<&mut Frame>, params: &[String]) {
    let Some(frame) = frame else { return };
    let Some(name) = var_name(params) else { return };
    if frame.variables.iter().any(|v| v.name == name) {
        return;
    }
    frame.variables.push(VarValue {
        name,
        type_name: params.get(2).cloned(),
        value: String::new(),
    });
}

/// `VARIABLE_ASSIGNMENT|[line]|name|value|...` → set `name`'s value in the top
/// frame (declaring it if it wasn't already in scope).
fn assign_var(frame: Option<&mut Frame>, params: &[String]) {
    let Some(frame) = frame else { return };
    let Some(name) = var_name(params) else { return };
    // ponytail: value = first field after name; a JSON value containing '|'
    // would be split — upgrade to rejoin trailing fields if that bites.
    let value = params.get(2).cloned().unwrap_or_default();
    if let Some(v) = frame.variables.iter_mut().find(|v| v.name == name) {
        v.value = value;
    } else {
        frame.variables.push(VarValue {
            name,
            type_name: None,
            value,
        });
    }
}

/// Variable name = the first param after the `[line]` bracket (`params[1]`).
fn var_name(params: &[String]) -> Option<String> {
    params.get(1).cloned().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    const LOG: &str = "67.0 APEX_CODE,FINEST\n\
        16:00:00.0 (10)|EXECUTION_STARTED\n\
        16:00:00.0 (20)|CODE_UNIT_STARTED|[EXTERNAL]|01p|MyClass.run()\n\
        16:00:00.0 (25)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n\
        16:00:00.0 (28)|VARIABLE_SCOPE_BEGIN|[6]|x|Integer|true|false\n\
        16:00:00.0 (30)|VARIABLE_ASSIGNMENT|[6]|x|1\n\
        16:00:00.0 (32)|USER_DEBUG|[8]|DEBUG|hi\n\
        16:00:00.0 (35)|VARIABLE_ASSIGNMENT|[9]|x|2\n\
        16:00:00.0 (36)|USER_DEBUG|[10]|DEBUG|after\n\
        16:00:00.0 (38)|METHOD_EXIT|[5]|MyClass.doWork()\n\
        16:00:00.0 (50)|CODE_UNIT_FINISHED|MyClass.run()\n\
        16:00:00.0 (55)|EXECUTION_FINISHED\n";

    fn units(text: &str) -> Vec<ExecUnit> {
        ParsedLog::parse(text).units
    }

    #[test]
    fn outline_stops_exclude_bookkeeping_closes_and_unmapped() {
        let s = build_outline(&units(LOG));
        // METHOD_ENTRY(2), USER_DEBUG(5), USER_DEBUG(7). CODE_UNIT_STARTED has no
        // line; var assignments + exits + execution events are not stops.
        let idx: Vec<usize> = s.steps.iter().map(|st| st.entry_index).collect();
        assert_eq!(idx, vec![2, 5, 7]);
        assert!(s.has_variables);
        assert_eq!(s.steps[0].depth, 2); // run → doWork
        assert!(s.steps.iter().all(|st| st.unit_index == 0));
        // Only the METHOD_ENTRY stop opens a frame; the USER_DEBUG stops don't.
        let frame_starts: Vec<bool> = s.steps.iter().map(|st| st.is_frame_start).collect();
        assert_eq!(frame_starts, vec![true, false, false]);
    }

    #[test]
    fn frames_at_method_entry_has_stack_no_vars_yet() {
        let u = units(LOG);
        let frames = frames_at(&u[0], 2); // METHOD_ENTRY doWork
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].signature, "MyClass.run()");
        assert_eq!(frames[1].signature, "MyClass.doWork()");
        assert_eq!(frames[1].line, Some(5));
        assert!(frames[1].variables.is_empty());
    }

    #[test]
    fn frames_at_reflects_variable_state_at_each_step() {
        let u = units(LOG);
        // First USER_DEBUG (entry 5): x assigned 1, line 8.
        let f1 = frames_at(&u[0], 5);
        assert_eq!(f1[1].line, Some(8));
        assert_eq!(f1[1].variables.len(), 1);
        assert_eq!(f1[1].variables[0].name, "x");
        assert_eq!(f1[1].variables[0].type_name.as_deref(), Some("Integer"));
        assert_eq!(f1[1].variables[0].value, "1");
        // Second USER_DEBUG (entry 7): x reassigned to 2, line 10.
        let f2 = frames_at(&u[0], 7);
        assert_eq!(f2[1].line, Some(10));
        assert_eq!(f2[1].variables[0].value, "2");
    }

    #[test]
    fn degrades_when_no_variable_events() {
        let text = "67.0 APEX_CODE,FINE\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (25)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n\
            16:00:00.0 (32)|USER_DEBUG|[8]|DEBUG|hi\n\
            16:00:00.0 (38)|METHOD_EXIT|[5]|MyClass.doWork()\n\
            16:00:00.0 (55)|EXECUTION_FINISHED\n";
        let u = units(text);
        let s = build_outline(&u);
        assert_eq!(s.steps.len(), 2);
        assert!(!s.has_variables);
        assert!(frames_at(&u[0], 3).iter().all(|f| f.variables.is_empty()));
    }

    #[test]
    fn concatenates_steps_across_units() {
        // Two execution units; the meaty method is in the SECOND unit.
        let text = "67.0 APEX_CODE,FINE\n\
            16:00:00.0 (10)|EXECUTION_STARTED\n\
            16:00:00.0 (15)|EXECUTION_FINISHED\n\
            16:00:00.0 (20)|EXECUTION_STARTED\n\
            16:00:00.0 (25)|METHOD_ENTRY|[5]|01p|MyClass.doWork()\n\
            16:00:00.0 (38)|METHOD_EXIT|[5]|MyClass.doWork()\n\
            16:00:00.0 (55)|EXECUTION_FINISHED\n";
        let s = build_outline(&units(text));
        assert_eq!(s.steps.len(), 1);
        assert_eq!(s.steps[0].unit_index, 1);
        assert_eq!(s.steps[0].source.class_name, "MyClass");
    }
}
