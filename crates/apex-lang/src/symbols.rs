use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ost {
    #[serde(default)]
    pub namespaces: Vec<Namespace>,
    #[serde(default)]
    pub org_types: Vec<ApexType>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Namespace {
    pub name: String,
    #[serde(default)]
    pub types: Vec<ApexType>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApexType {
    pub name: String,
    pub kind: TypeKind,
    /// Superclass name (Tooling SymbolTable `parentClass`); `None` when the type
    /// extends nothing or the source has no inheritance info (e.g. stdlib).
    #[serde(default)]
    pub parent_class: Option<String>,
    /// Implemented interface names (Tooling SymbolTable `interfaces`).
    #[serde(default)]
    pub interfaces: Vec<String>,
    #[serde(default)]
    pub methods: Vec<Method>,
    #[serde(default)]
    pub properties: Vec<Property>,
    #[serde(default)]
    pub enum_values: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypeKind {
    #[default]
    Class,
    Interface,
    Enum,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Method {
    pub name: String,
    pub return_type: String,
    #[serde(default)]
    pub params: Vec<String>,
    pub is_static: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Property {
    pub name: String,
    pub prop_type: String,
    pub is_static: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Member<'a> {
    Method(&'a Method),
    Property(&'a Property),
}

impl Ost {
    pub fn type_in(&self, namespace: &str, name: &str) -> Option<&ApexType> {
        self.namespaces
            .iter()
            .find(|ns| ns.name.eq_ignore_ascii_case(namespace))?
            .types
            .iter()
            .find(|ty| ty.name.eq_ignore_ascii_case(name))
    }

    pub fn org_type(&self, name: &str) -> Option<&ApexType> {
        self.org_types
            .iter()
            .find(|ty| ty.name.eq_ignore_ascii_case(name))
    }
}

/// Upper bound on supertype traversal — cycle/pathology guard.
const MAX_SUPERTYPES: usize = 32;

/// Resolve `name` to a type: org types first, then every namespace.
pub fn resolve_type<'a>(ost: &'a Ost, name: &str) -> Option<&'a ApexType> {
    ost.org_type(name).or_else(|| {
        ost.namespaces
            .iter()
            .flat_map(|namespace| namespace.types.iter())
            .find(|ty| ty.name.eq_ignore_ascii_case(name))
    })
}

/// `ty` followed by its transitive supertypes (`parent_class` chain merged with
/// `interfaces`), resolved against `ost`. Child-first order (so closer types win
/// on member lookup), cycle-safe, capped at [`MAX_SUPERTYPES`] types.
pub fn supertype_chain<'a>(ost: &'a Ost, ty: &'a ApexType) -> Vec<&'a ApexType> {
    let mut chain: Vec<&ApexType> = vec![ty];
    let mut i = 0;
    while i < chain.len() && chain.len() < MAX_SUPERTYPES {
        let cur = chain[i];
        i += 1;
        for super_name in cur.parent_class.iter().chain(cur.interfaces.iter()) {
            let Some(super_ty) = resolve_type(ost, simple_type_name(super_name)) else {
                continue;
            };
            if !chain.iter().any(|seen| std::ptr::eq(*seen, super_ty)) {
                chain.push(super_ty);
            }
        }
    }
    chain
}

/// `Ns.Base<T>` → `Base`: generics- and namespace-stripped lookup key.
fn simple_type_name(name: &str) -> &str {
    let base = name.split('<').next().unwrap_or(name).trim();
    base.rsplit('.').next().unwrap_or(base)
}

/// Method `name` on `ty` or any of its supertypes (closest type wins).
pub fn find_method<'a>(ost: &'a Ost, ty: &'a ApexType, name: &str) -> Option<&'a Method> {
    supertype_chain(ost, ty)
        .into_iter()
        .find_map(|t| t.methods.iter().find(|m| m.name.eq_ignore_ascii_case(name)))
}

/// Property `name` on `ty` or any of its supertypes (closest type wins).
pub fn find_property<'a>(ost: &'a Ost, ty: &'a ApexType, name: &str) -> Option<&'a Property> {
    supertype_chain(ost, ty).into_iter().find_map(|t| {
        t.properties
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
    })
}

impl ApexType {
    pub fn member(&self, name: &str) -> Option<Member<'_>> {
        self.methods
            .iter()
            .find(|method| method.name.eq_ignore_ascii_case(name))
            .map(Member::Method)
            .or_else(|| {
                self.properties
                    .iter()
                    .find(|property| property.name.eq_ignore_ascii_case(name))
                    .map(Member::Property)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ost() -> Ost {
        Ost {
            namespaces: vec![Namespace {
                name: "System".to_string(),
                types: vec![
                    ApexType {
                        name: "String".to_string(),
                        kind: TypeKind::Class,
                        methods: vec![Method {
                            name: "valueOf".to_string(),
                            return_type: "String".to_string(),
                            params: vec!["Integer".to_string()],
                            is_static: true,
                        }],
                        properties: vec![],
                        parent_class: None,
                        interfaces: vec![],
                        enum_values: vec![],
                    },
                    ApexType {
                        name: "Database".to_string(),
                        kind: TypeKind::Class,
                        methods: vec![],
                        properties: vec![],
                        parent_class: None,
                        interfaces: vec![],
                        enum_values: vec![],
                    },
                ],
            }],
            org_types: vec![],
        }
    }

    #[test]
    fn ost_finds_types_and_members_case_insensitively() {
        let ost = sample_ost();

        let string_type = ost.type_in("System", "string").unwrap();

        assert_eq!(string_type.name, "String");
        assert!(ost.org_type("Foo").is_none());
        assert!(matches!(
            string_type.member("VALUEOF"),
            Some(Member::Method(method)) if method.name == "valueOf"
        ));
    }

    fn named_type(name: &str, parent: Option<&str>, methods: Vec<Method>) -> ApexType {
        ApexType {
            name: name.to_string(),
            kind: TypeKind::Class,
            parent_class: parent.map(str::to_string),
            interfaces: vec![],
            methods,
            properties: vec![],
            enum_values: vec![],
        }
    }

    fn method(name: &str, return_type: &str) -> Method {
        Method {
            name: name.to_string(),
            return_type: return_type.to_string(),
            params: vec![],
            is_static: false,
        }
    }

    #[test]
    fn resolve_type_searches_org_types_then_namespaces() {
        let ost = sample_ost();
        assert_eq!(resolve_type(&ost, "string").unwrap().name, "String");
        assert!(resolve_type(&ost, "missing").is_none());
    }

    #[test]
    fn find_method_walks_parent_class_chain() {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![
                named_type("Base", None, vec![method("greet", "String")]),
                named_type("Mid", Some("Base"), vec![]),
                named_type("Child", Some("Mid"), vec![method("own", "Integer")]),
            ],
        };
        let child = ost.org_type("Child").unwrap();

        assert_eq!(find_method(&ost, child, "own").unwrap().return_type, "Integer");
        assert_eq!(
            find_method(&ost, child, "greet").unwrap().return_type,
            "String",
            "method inherited through two-level parent_class chain"
        );
        assert!(find_method(&ost, child, "missing").is_none());
    }

    #[test]
    fn find_member_prefers_subclass_override() {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![
                named_type("Base", None, vec![method("run", "Object")]),
                named_type("Child", Some("Base"), vec![method("run", "String")]),
            ],
        };
        let child = ost.org_type("Child").unwrap();
        assert_eq!(find_method(&ost, child, "run").unwrap().return_type, "String");
    }

    #[test]
    fn find_property_merges_interfaces_and_survives_cycles() {
        let mut iface = named_type("HasName", Some("Loop"), vec![]);
        iface.properties = vec![Property {
            name: "name".to_string(),
            prop_type: "String".to_string(),
            is_static: false,
        }];
        // `Loop` points back at `Invoice` — the walk must terminate.
        let mut invoice = named_type("Invoice", Some("Loop"), vec![]);
        invoice.interfaces = vec!["HasName".to_string()];
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![
                invoice,
                iface,
                named_type("Loop", Some("Invoice"), vec![method("looped", "void")]),
            ],
        };
        let ty = ost.org_type("Invoice").unwrap();

        assert_eq!(
            find_property(&ost, ty, "name").unwrap().prop_type,
            "String",
            "property from implemented interface"
        );
        assert!(find_method(&ost, ty, "looped").is_some());
    }

    #[test]
    fn apex_type_round_trips_and_ignores_unknown_keys() {
        let raw = r#"{
            "name": "String",
            "kind": "class",
            "methods": [],
            "properties": [],
            "enum_values": [],
            "extra": "ignored"
        }"#;

        let ty: ApexType = serde_json::from_str(raw).unwrap();
        let encoded = serde_json::to_string(&ty).unwrap();
        let decoded: ApexType = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.name, "String");
        assert_eq!(decoded.kind, TypeKind::Class);
    }
}
