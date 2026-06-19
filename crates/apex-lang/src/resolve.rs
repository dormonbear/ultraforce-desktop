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
        let ty = base_type_name(&local.declared_type);
        return resolve_type(ost, ty).or_else(|| {
            // Dotted declared type (e.g. `Outer.Inner`): inner/qualified types are stored
            // under their simple name, so retry with the last `.` segment.
            ty.rsplit('.')
                .next()
                .filter(|s| *s != ty)
                .and_then(|simple| resolve_type(ost, simple))
        });
    }

    resolve_type(ost, receiver)
}

/// `List<Account>` → `List`; `Account` → `Account`. Trims whitespace.
fn base_type_name(t: &str) -> &str {
    t.split('<').next().unwrap_or(t).trim()
}

/// Top-level generic args of a type string: `Map<Id, List<Account>>` → `["Id", "List<Account>"]`.
/// Empty when the type is non-generic. Splits on commas only at angle-bracket depth 0.
fn generic_args(t: &str) -> Vec<String> {
    let t = t.trim();
    let (Some(lt), Some(gt)) = (t.find('<'), t.rfind('>')) else {
        return Vec::new();
    };
    if gt <= lt + 1 {
        return Vec::new();
    }
    let inner = &t[lt + 1..gt];
    let mut args = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, c) in inner.char_indices() {
        match c {
            '<' => depth += 1,
            '>' => depth -= 1,
            ',' if depth == 0 => {
                args.push(inner[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    let last = inner[start..].trim();
    if !last.is_empty() {
        args.push(last.to_string());
    }
    args
}

/// Element/value type for the well-known generic collection accessors, derived from the receiver's
/// own type args — independent of how stdlib encodes generic return types.
/// ponytail: hardcoded List/Set/Map accessors; extend the table if more generic APIs need it.
fn collection_element(receiver_type: &str, seg: &Segment) -> Option<String> {
    if !seg.is_call {
        return None;
    }
    let base = base_type_name(receiver_type).to_ascii_lowercase();
    let args = generic_args(receiver_type);
    let method = seg.name.to_ascii_lowercase();
    match (base.as_str(), method.as_str()) {
        ("list", "get") => args.first().cloned(),
        ("map", "get") => args.get(1).cloned(),
        ("map", "values") => args.get(1).map(|v| format!("List<{v}>")),
        ("map", "keyset") => args.first().map(|k| format!("Set<{k}>")),
        _ => None,
    }
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
    let (mut cur, mut cur_str, rest): (&ApexType, String, &[Segment]) = if let Some(local) = outline
        .locals
        .iter()
        .find(|local| local.name.eq_ignore_ascii_case(&base.name))
    {
        let s = local.declared_type.clone();
        (resolve_type(ost, base_type_name(&s))?, s, rest)
    } else if let Some(ty) = resolve_type(ost, base_type_name(&base.name)) {
        (ty, base.name.clone(), rest)
    } else if let Some((next, tail)) = rest.split_first() {
        // namespace-qualified head: `Namespace.Type`
        if next.is_call {
            return None;
        }
        (
            ost.type_in(&base.name, &next.name)?,
            next.name.clone(),
            tail,
        )
    } else {
        return None;
    };

    for seg in rest.iter() {
        let next_str: String = if let Some(elem) = collection_element(&cur_str, seg) {
            elem
        } else if seg.is_call {
            cur.methods
                .iter()
                .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?
                .return_type
                .clone()
        } else if let Some(p) = cur
            .properties
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(&seg.name))
        {
            p.prop_type.clone()
        } else {
            // getter-as-method fallback
            cur.methods
                .iter()
                .find(|m| m.name.eq_ignore_ascii_case(&seg.name))?
                .return_type
                .clone()
        };
        if base_type_name(&next_str).eq_ignore_ascii_case("void") {
            return None;
        }
        cur = resolve_type(ost, base_type_name(&next_str))?;
        cur_str = next_str;
    }
    Some(cur)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::{ApexOutline, LocalVar};
    use crate::symbols::{ApexType, Method, Namespace, Ost, Property, TypeKind};

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
    fn resolve_receiver_type_resolves_dotted_local_type_by_simple_name() {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Inner".to_string(),
                kind: TypeKind::Class,
                methods: vec![Method {
                    name: "ping".to_string(),
                    return_type: "void".to_string(),
                    params: vec![],
                    is_static: false,
                }],
                properties: vec![],
                enum_values: vec![],
            }],
        };
        let outline = ApexOutline {
            locals: vec![LocalVar {
                name: "x".to_string(),
                declared_type: "Outer.Inner".to_string(),
            }],
        };

        let ty = resolve_receiver_type(&ost, &outline, "x").unwrap();
        assert_eq!(ty.name, "Inner");
        assert!(ty.methods.iter().any(|m| m.name == "ping"));
    }

    #[test]
    fn generic_args_parses_nested() {
        assert_eq!(generic_args("List<Account>"), vec!["Account".to_string()]);
        assert_eq!(
            generic_args("Map<Id, Account>"),
            vec!["Id".to_string(), "Account".to_string()]
        );
        assert_eq!(
            generic_args("Map<Id, List<Account>>"),
            vec!["Id".to_string(), "List<Account>".to_string()]
        );
        assert!(generic_args("Account").is_empty());
    }

    #[test]
    fn collection_element_known_accessors() {
        let call = |n: &str| Segment {
            name: n.into(),
            is_call: true,
        };
        assert_eq!(
            collection_element("List<Account>", &call("get")).as_deref(),
            Some("Account")
        );
        assert_eq!(
            collection_element("Map<Id,Account>", &call("get")).as_deref(),
            Some("Account")
        );
        assert_eq!(
            collection_element("Map<Id,Account>", &call("values")).as_deref(),
            Some("List<Account>")
        );
        assert_eq!(
            collection_element("Map<Id,Account>", &call("keySet")).as_deref(),
            Some("Set<Id>")
        );
        assert!(collection_element(
            "List<Account>",
            &Segment {
                name: "size".into(),
                is_call: true
            }
        )
        .is_none());
        assert!(collection_element("Account", &call("get")).is_none());
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

    #[test]
    fn resolve_expr_type_unwraps_generic_collections() {
        use crate::parser::Segment;
        let elem = ApexType {
            name: "Account".into(),
            kind: TypeKind::Class,
            methods: vec![],
            properties: vec![Property {
                name: "Name".into(),
                prop_type: "String".into(),
                is_static: false,
            }],
            enum_values: vec![],
        };
        // List/Map need only to EXIST in the OST (their stdlib get() return type is irrelevant now).
        let collection = |name: &str| ApexType {
            name: name.into(),
            kind: TypeKind::Class,
            methods: vec![
                Method {
                    name: "get".into(),
                    return_type: "Object".into(),
                    params: vec![],
                    is_static: false,
                },
                Method {
                    name: "values".into(),
                    return_type: "List".into(),
                    params: vec![],
                    is_static: false,
                },
            ],
            properties: vec![],
            enum_values: vec![],
        };
        let ost = Ost {
            namespaces: vec![Namespace {
                name: "System".into(),
                types: vec![collection("List"), collection("Map"), elem],
            }],
            org_types: vec![],
        };
        let call = |n: &str| Segment {
            name: n.into(),
            is_call: true,
        };
        let var = |n: &str| Segment {
            name: n.into(),
            is_call: false,
        };

        let lst = ApexOutline {
            locals: vec![LocalVar {
                name: "l".into(),
                declared_type: "List<Account>".into(),
            }],
        };
        assert_eq!(
            resolve_expr_type(&ost, &lst, &[var("l"), call("get")])
                .unwrap()
                .name,
            "Account"
        );

        let map = ApexOutline {
            locals: vec![LocalVar {
                name: "m".into(),
                declared_type: "Map<Id, Account>".into(),
            }],
        };
        assert_eq!(
            resolve_expr_type(&ost, &map, &[var("m"), call("get")])
                .unwrap()
                .name,
            "Account"
        );
        // values() → List<Account>, then get() → Account
        assert_eq!(
            resolve_expr_type(&ost, &map, &[var("m"), call("values"), call("get")])
                .unwrap()
                .name,
            "Account"
        );
    }

    #[test]
    fn resolve_expr_type_resolves_namespace_qualified_head() {
        use crate::parser::Segment;
        let described = ApexType {
            name: "DescribeSObjectResult".into(),
            kind: TypeKind::Class,
            methods: vec![Method {
                name: "getName".into(),
                return_type: "String".into(),
                params: vec![],
                is_static: false,
            }],
            properties: vec![],
            enum_values: vec![],
        };
        let ost = Ost {
            namespaces: vec![Namespace {
                name: "Schema".into(),
                types: vec![described],
            }],
            org_types: vec![],
        };
        let outline = ApexOutline::default();
        let seg = |n: &str| Segment {
            name: n.into(),
            is_call: false,
        };
        // `Schema.DescribeSObjectResult.` -> the type itself
        let t = resolve_expr_type(
            &ost,
            &outline,
            &[seg("Schema"), seg("DescribeSObjectResult")],
        )
        .unwrap();
        assert_eq!(t.name, "DescribeSObjectResult");
        // unknown namespace member -> None
        assert!(resolve_expr_type(&ost, &outline, &[seg("Schema"), seg("Nope")]).is_none());
        // a bare unknown head with no namespace match -> None
        assert!(resolve_expr_type(&ost, &outline, &[seg("Bogus"), seg("X")]).is_none());
    }
}
