use crate::entry::LogEntry;
use crate::event::ScopeKind;
use crate::parse::ExecUnit;

/// A node in the nested execution tree.
#[derive(Debug, Clone)]
pub struct ExecNode {
    pub entry: LogEntry,
    pub children: Vec<ExecNode>,
    /// Total elapsed time for this scope (`end - start`), or `None` for a leaf /
    /// unclosed scope.
    pub dur_ns: Option<u64>,
    /// Self time: `dur_ns` minus the total time of direct children — the time
    /// spent in this frame itself, the key signal for finding hotspots.
    pub self_ns: Option<u64>,
}

/// Self time = total minus the summed duration of direct children.
fn self_time(dur_ns: Option<u64>, children: &[ExecNode]) -> Option<u64> {
    let dur = dur_ns?;
    let child_sum: u64 = children.iter().filter_map(|c| c.dur_ns).sum();
    Some(dur.saturating_sub(child_sum))
}

/// Build a nested tree from a flat unit by pairing scope start/end events.
pub fn build_tree(unit: &ExecUnit) -> Vec<ExecNode> {
    let mut roots: Vec<ExecNode> = Vec::new();
    let mut stack: Vec<ExecNode> = Vec::new();

    for entry in &unit.entries {
        match entry.event.scope_kind() {
            ScopeKind::Start => {
                stack.push(ExecNode {
                    entry: entry.clone(),
                    children: Vec::new(),
                    dur_ns: None,
                    self_ns: None,
                });
            }
            ScopeKind::End => {
                if let Some(mut node) = stack.pop() {
                    node.dur_ns = Some(entry.nanos.saturating_sub(node.entry.nanos));
                    node.self_ns = self_time(node.dur_ns, &node.children);
                    attach(&mut roots, &mut stack, node);
                } else {
                    attach(
                        &mut roots,
                        &mut stack,
                        ExecNode {
                            entry: entry.clone(),
                            children: Vec::new(),
                            dur_ns: None,
                            self_ns: None,
                        },
                    );
                }
            }
            ScopeKind::Leaf => {
                attach(
                    &mut roots,
                    &mut stack,
                    ExecNode {
                        entry: entry.clone(),
                        children: Vec::new(),
                        dur_ns: None,
                        self_ns: None,
                    },
                );
            }
        }
    }
    // Flush any unclosed scopes, deepest first, into their parents/roots.
    while let Some(node) = stack.pop() {
        attach(&mut roots, &mut stack, node);
    }
    roots
}

fn attach(roots: &mut Vec<ExecNode>, stack: &mut [ExecNode], node: ExecNode) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;

    #[test]
    fn nests_scopes_and_computes_duration() {
        let text = "67.0 X,Y\n\
            16:55:57.42 (10)|EXECUTION_STARTED\n\
            16:55:57.42 (20)|CODE_UNIT_STARTED|x\n\
            16:55:57.42 (30)|USER_DEBUG|hi\n\
            16:55:57.42 (40)|CODE_UNIT_FINISHED|x\n\
            16:55:57.42 (50)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].dur_ns, Some(40)); // 50 - 10
        assert_eq!(roots[0].self_ns, Some(20)); // 40 total - 20 in the child
        assert_eq!(roots[0].children.len(), 1); // CODE_UNIT
        assert_eq!(roots[0].children[0].dur_ns, Some(20)); // 40 - 20
        assert_eq!(roots[0].children[0].self_ns, Some(20)); // 20 total - 0 (leaf has no dur)
        assert_eq!(roots[0].children[0].children.len(), 1); // USER_DEBUG leaf
    }

    #[test]
    fn unmatched_end_becomes_root_leaf() {
        let text = "67.0 X,Y\n16:55:57.42 (10)|CODE_UNIT_FINISHED|x\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        assert_eq!(roots.len(), 1);
        assert!(roots[0].children.is_empty());
        assert_eq!(roots[0].dur_ns, None);
    }
}
