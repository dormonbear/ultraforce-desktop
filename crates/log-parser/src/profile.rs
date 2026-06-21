//! Aggregate hotspot profiling over the execution tree — group method / unit
//! frames by signature and sum their self/total time and call count, mirroring
//! that plugin's aggregate stack-frame view. The biggest analytical win for finding slow
//! methods across an entire log.

use crate::event::LogEvent;
use crate::tree::ExecNode;
use std::collections::HashMap;

/// An aggregated invocable frame across the whole execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hotspot {
    /// The method / constructor / code-unit signature.
    pub signature: String,
    /// Summed self time across all invocations.
    pub self_ns: u64,
    /// Summed total (inclusive) time across all invocations.
    pub total_ns: u64,
    /// Summed self heap: bytes allocated directly in this frame (its own
    /// `HEAP_ALLOCATE` events), across all invocations.
    pub self_bytes: u64,
    /// Number of invocations.
    pub count: usize,
}

/// `Bytes:N` param value from a `HEAP_ALLOCATE` entry.
fn heap_bytes(params: &[String]) -> u64 {
    params
        .iter()
        .find_map(|p| p.strip_prefix("Bytes:")?.parse().ok())
        .unwrap_or(0)
}

/// Heap allocated directly in this frame: its own `HEAP_ALLOCATE` children.
fn frame_self_bytes(node: &ExecNode) -> u64 {
    node.children
        .iter()
        .filter(|c| c.entry.event == LogEvent::HeapAllocate)
        .map(|c| heap_bytes(&c.entry.params))
        .sum()
}

/// The signature of an invocable frame (`Method/Constructor entry`, `CodeUnit`),
/// or `None` for non-frame nodes. The signature is the last log param (the fully
/// qualified method/unit name; line-number params vary per call and are ignored).
fn frame_signature(node: &ExecNode) -> Option<String> {
    use LogEvent::*;
    if !matches!(
        node.entry.event,
        MethodEntry | ConstructorEntry | CodeUnitStarted
    ) {
        return None;
    }
    node.entry.params.last().filter(|s| !s.is_empty()).cloned()
}

/// Aggregate method/unit frames by signature, sorted by self time descending
/// (the hotspots), tie-broken by signature for stable output.
pub fn hotspots(roots: &[ExecNode]) -> Vec<Hotspot> {
    let mut map: HashMap<String, Hotspot> = HashMap::new();
    for root in roots {
        walk(root, &mut map);
    }
    let mut out: Vec<Hotspot> = map.into_values().collect();
    out.sort_by(|a, b| {
        b.self_ns
            .cmp(&a.self_ns)
            .then_with(|| a.signature.cmp(&b.signature))
    });
    out
}

fn walk(node: &ExecNode, map: &mut HashMap<String, Hotspot>) {
    if let (Some(sig), Some(total)) = (frame_signature(node), node.dur_ns) {
        let h = map.entry(sig.clone()).or_insert_with(|| Hotspot {
            signature: sig,
            self_ns: 0,
            total_ns: 0,
            self_bytes: 0,
            count: 0,
        });
        h.self_ns += node.self_ns.unwrap_or(0);
        h.total_ns += total;
        h.self_bytes += frame_self_bytes(node);
        h.count += 1;
    }
    for child in &node.children {
        walk(child, map);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::ParsedLog;
    use crate::tree::build_tree;

    #[test]
    fn aggregates_frames_by_signature() {
        // `slow()` is called twice; `fast()` once. Self time = total minus child.
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|METHOD_ENTRY|[1]|01p|C.slow()\n\
            00:00:00.0 (10)|METHOD_ENTRY|[2]|01p|C.fast()\n\
            00:00:00.0 (40)|METHOD_EXIT|[2]|01p|C.fast()\n\
            00:00:00.0 (110)|METHOD_EXIT|[1]|01p|C.slow()\n\
            00:00:00.0 (200)|METHOD_ENTRY|[1]|01p|C.slow()\n\
            00:00:00.0 (260)|METHOD_EXIT|[1]|01p|C.slow()\n\
            00:00:00.0 (300)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        let hs = hotspots(&roots);

        let slow = hs.iter().find(|h| h.signature == "C.slow()").unwrap();
        // call 1: total 100 (110-10), child fast=30 → self 70. call 2: total 60, self 60.
        assert_eq!(slow.count, 2);
        assert_eq!(slow.total_ns, 160); // 100 + 60
        assert_eq!(slow.self_ns, 130); // 70 + 60
        let fast = hs.iter().find(|h| h.signature == "C.fast()").unwrap();
        assert_eq!(fast.count, 1);
        assert_eq!(fast.self_ns, 30);

        // Sorted by self time desc → slow first.
        assert_eq!(hs[0].signature, "C.slow()");
    }

    #[test]
    fn attributes_self_heap_to_the_frame() {
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|METHOD_ENTRY|[1]|01p|C.alloc()\n\
            00:00:00.0 (20)|HEAP_ALLOCATE|[2]|Bytes:48\n\
            00:00:00.0 (30)|HEAP_ALLOCATE|[3]|Bytes:16\n\
            00:00:00.0 (40)|METHOD_EXIT|[1]|01p|C.alloc()\n\
            00:00:00.0 (90)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let hs = hotspots(&build_tree(&log.units[0]));
        let alloc = hs.iter().find(|h| h.signature == "C.alloc()").unwrap();
        assert_eq!(alloc.self_bytes, 64); // 48 + 16
    }

    #[test]
    fn ignores_non_frame_events() {
        let text = "67.0 X,Y\n\
            00:00:00.0 (0)|EXECUTION_STARTED\n\
            00:00:00.0 (10)|USER_DEBUG|[1]|DEBUG|hi\n\
            00:00:00.0 (300)|EXECUTION_FINISHED\n";
        let log = ParsedLog::parse(text);
        let roots = build_tree(&log.units[0]);
        // No method/unit frames → no hotspots (EXECUTION itself isn't a frame).
        assert!(hotspots(&roots).is_empty());
    }
}
