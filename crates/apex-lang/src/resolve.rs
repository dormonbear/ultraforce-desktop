use crate::parser::{ApexOutline, Segment};
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

/// `List<Account>` → `List`; `Account` → `Account`. Trims whitespace.
fn base_type_name(t: &str) -> &str {
    t.split('<').next().unwrap_or(t).trim()
}

/// Resolve the type of a receiver chain (left→right). Returns None if any link fails to resolve,
/// if a base call (no receiver type) appears, or if a step returns `void`.
pub fn resolve_expr_type<'a>(
    ost: &'a Ost,
    outline: &ApexOutline,
    chain: &[Segment],
) -> Option<&'a ApexType> {
    let (base, rest) = chain.split_first()?;
    if base.is_call {
        return None; // free function / unqualified call — unsupported in MVP
    }
    let mut cur = resolve_receiver_type(ost, outline, &base.name)?;
    for seg in rest {
        let next_name: &str = if seg.is_call {
            let m = cur
                .methods
                .iter()
                .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?;
            base_type_name(&m.return_type)
        } else if let Some(p) = cur
            .properties
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(&seg.name))
        {
            base_type_name(&p.prop_type)
        } else {
            // getter-as-method fallback
            let m = cur
                .methods
                .iter()
                .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?;
            base_type_name(&m.return_type)
        };
        if next_name.eq_ignore_ascii_case("void") {
            return None;
        }
        cur = resolve_type(ost, next_name)?;
    }
    Some(cur)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::{ApexOutline, LocalVar};
    use crate::symbols::{ApexType, Method, Namespace, Ost, TypeKind};

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

    #[test]
    fn resolve_expr_type_walks_call_chain() {
        use crate::parser::Segment;
        // Account has instance method `self_` returning "Account"
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".into(),
                kind: TypeKind::Class,
                methods: vec![Method {
                    name: "self_".into(),
                    return_type: "Account".into(),
                    params: vec![],
                    is_static: false,
                }],
                properties: vec![],
                enum_values: vec![],
            }],
        };
        let outline = ApexOutline {
            locals: vec![LocalVar {
                name: "a".into(),
                declared_type: "Account".into(),
            }],
        };
        let chain = vec![
            Segment {
                name: "a".into(),
                is_call: false,
            },
            Segment {
                name: "self_".into(),
                is_call: true,
            },
        ];
        assert_eq!(
            resolve_expr_type(&ost, &outline, &chain).unwrap().name,
            "Account"
        );

        // unknown member → None
        let bad = vec![
            Segment {
                name: "a".into(),
                is_call: false,
            },
            Segment {
                name: "nope".into(),
                is_call: true,
            },
        ];
        assert!(resolve_expr_type(&ost, &outline, &bad).is_none());
    }
}
