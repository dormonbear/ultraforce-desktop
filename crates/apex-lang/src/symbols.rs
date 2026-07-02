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
