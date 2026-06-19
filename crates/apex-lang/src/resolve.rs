use crate::parser::ApexOutline;
use crate::symbols::{ApexType, Ost};

pub fn resolve_type<'a>(ost: &'a Ost, name: &str) -> Option<&'a ApexType> {
    ost.org_type(name).or_else(|| {
        ost.namespaces
            .iter()
            .flat_map(|namespace| namespace.types.iter())
            .find(|ty| ty.name.eq_ignore_ascii_case(name))
    })
}

pub fn resolve_receiver_type<'a>(
    ost: &'a Ost,
    outline: &ApexOutline,
    receiver: &str,
) -> Option<&'a ApexType> {
    if let Some(local) = outline
        .locals
        .iter()
        .find(|local| local.name.eq_ignore_ascii_case(receiver))
    {
        return resolve_type(ost, &local.declared_type);
    }

    resolve_type(ost, receiver)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::{ApexOutline, LocalVar};
    use crate::symbols::{ApexType, Namespace, Ost, TypeKind};

    fn ost() -> Ost {
        Ost {
            namespaces: vec![Namespace {
                name: "System".to_string(),
                types: vec![ApexType {
                    name: "String".to_string(),
                    kind: TypeKind::Class,
                    methods: vec![],
                    properties: vec![],
                    enum_values: vec![],
                }],
            }],
            org_types: vec![ApexType {
                name: "Account".to_string(),
                kind: TypeKind::Class,
                methods: vec![],
                properties: vec![],
                enum_values: vec![],
            }],
        }
    }

    #[test]
    fn resolves_types_and_receiver_types() {
        let ost = ost();
        let outline = ApexOutline {
            locals: vec![LocalVar {
                name: "a".to_string(),
                declared_type: "Account".to_string(),
            }],
        };

        assert_eq!(resolve_type(&ost, "string").unwrap().name, "String");
        assert_eq!(
            resolve_receiver_type(&ost, &outline, "a").unwrap().name,
            "Account"
        );
        assert_eq!(
            resolve_receiver_type(&ost, &outline, "String")
                .unwrap()
                .name,
            "String"
        );
        assert!(resolve_receiver_type(&ost, &outline, "missing").is_none());
    }
}
