//! Curated platform-stdlib inheritance links.
//!
//! The Tooling completions payload (`GET …/tooling/completions?type=apex`) carries
//! no inheritance info — verified against real cached payloads: **0 of 7 575–31 287
//! types** across three orgs' API-67.0 payloads have `parentClass` or `interfaces`,
//! and members are not flattened (a subclass lists only its own methods). Org
//! classes get their links from the Tooling `SymbolTable` (`parentClass` /
//! `interfaces`, see `parse_org_types`), so the completion engine's lazy
//! [`supertype_chain`](crate::symbols::supertype_chain) walk already works for
//! them. This module supplies the equivalent for the platform stdlib.
//!
//! Rule: every built-in exception extends `System.Exception` — documented
//! ("All exception classes extend the system-defined base class Exception").
//! Entries are **documented-safe only**: when a deeper parent is not verified we
//! link to `System.Exception` rather than guess a wrong chain (a wrong link is
//! worse than none — it would surface members the type does not have).

/// Parent class of a platform-stdlib type, or `None` when unknown.
///
/// `namespace` is the payload namespace (`System`, `Apex`, …) — currently unused
/// by the exception rule but part of the signature so future curated entries
/// (SObject hierarchy, managed-package namespaces) can be keyed by it.
pub fn stdlib_parent(namespace: &str, type_name: &str) -> Option<&'static str> {
    let _ = namespace;
    if type_name == "Exception" {
        // Root of the exception tree — linking it to itself would only feed the
        // cycle guard.
        return None;
    }
    type_name
        .ends_with("Exception")
        .then_some("System.Exception")
}

#[cfg(test)]
mod tests {
    use super::stdlib_parent;

    #[test]
    fn exceptions_link_to_system_exception() {
        for ty in ["DmlException", "EmptyStackException", "NullPointerException"] {
            assert_eq!(
                stdlib_parent("System", ty),
                Some("System.Exception"),
                "{ty}"
            );
        }
    }

    #[test]
    fn exception_root_has_no_parent() {
        assert_eq!(stdlib_parent("System", "Exception"), None);
    }

    #[test]
    fn non_exceptions_have_no_parent() {
        for ty in ["String", "SObject", "Database", "List", "ExceptionUtils"] {
            assert_eq!(stdlib_parent("System", ty), None, "{ty}");
        }
    }

    #[test]
    fn namespaced_exceptions_still_link_to_system_exception() {
        // Managed-package/platform exceptions (cache.*, reports.*, …) follow the
        // same documented rule.
        assert_eq!(
            stdlib_parent("cache", "CacheException"),
            Some("System.Exception")
        );
    }

    #[test]
    fn parsed_stdlib_completion_surfaces_inherited_exception_methods() {
        // End to end: `parse_stdlib` fills the curated parent, and the engine's
        // lazy `supertype_chain` walk (the same path org classes use) surfaces
        // the parent's methods in completion. Mirrors the real payload shape:
        // constructors/methods/properties only — no parentClass/interfaces, as
        // verified against live payloads.
        let raw = serde_json::json!({
            "publicDeclarations": {
                "System": {
                    "Exception": {
                        "constructors": [],
                        "methods": [
                            {"name": "getMessage"},
                            {"name": "getCause"},
                            {"name": "getLineNumber"}
                        ],
                        "properties": []
                    },
                    "DmlException": {
                        "constructors": [],
                        "methods": [{"name": "getNumDml"}],
                        "properties": []
                    },
                    "String": {
                        "constructors": [],
                        "methods": [],
                        "properties": []
                    }
                },
                "Apex": {
                    "EmptyStackException": {
                        "constructors": [],
                        "methods": [{"name": "clone"}],
                        "properties": []
                    }
                }
            }
        });

        let namespaces = crate::acquire::parse_stdlib(&raw);
        let ty = |ns: &str, name: &str| {
            namespaces
                .iter()
                .find(|n| n.name == ns)
                .unwrap()
                .types
                .iter()
                .find(|t| t.name == name)
                .unwrap()
                .clone()
        };

        assert_eq!(ty("System", "DmlException").parent_class, Some("System.Exception".into()));
        assert_eq!(ty("Apex", "EmptyStackException").parent_class, Some("System.Exception".into()));
        assert_eq!(ty("System", "Exception").parent_class, None);
        assert_eq!(ty("System", "String").parent_class, None);

        let ost = crate::symbols::Ost {
            namespaces,
            org_types: vec![],
        };
        let src = "class C { void m(DmlException e) { e.| } }";
        let cursor = src.find('|').unwrap();
        let cleaned = src.replacen('|', "", 1);
        let cands = crate::complete_source(&cleaned, cursor, &ost);
        let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
        assert!(labels.contains(&"getNumDml"), "own method: {labels:?}");
        assert!(labels.contains(&"getMessage"), "inherited from Exception: {labels:?}");
        assert!(labels.contains(&"getCause"), "inherited from Exception: {labels:?}");
    }
}
