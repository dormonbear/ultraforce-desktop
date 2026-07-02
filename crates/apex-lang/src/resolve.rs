use crate::parser::{ApexOutline, Segment};
use crate::symbols::{ApexType, Method, Ost, Property};

/// Upper bound on supertype traversal — cycle/pathology guard.
const MAX_SUPERTYPES: usize = 32;

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
    let base = base_type_name(name);
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
            find_method(ost, cur, &seg.name)?.return_type.clone()
        } else if let Some(p) = find_property(ost, cur, &seg.name) {
            p.prop_type.clone()
        } else {
            // getter-as-method fallback
            find_method(ost, cur, &seg.name)?.return_type.clone()
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
                    parent_class: None,
                    interfaces: vec![],
                    enum_values: vec![],
                }],
            }],
            org_types: vec![ApexType {
                name: "Account".to_string(),
                kind: TypeKind::Class,
                methods: vec![],
                properties: vec![],
                parent_class: None,
                interfaces: vec![],
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
                parent_class: None,
                interfaces: vec![],
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
    fn resolve_expr_type_uses_inherited_members() {
        let ost = Ost {
            namespaces: vec![],
            org_types: vec![
                named_type("Base", None, vec![method("self_", "Base")]),
                named_type("Child", Some("Base"), vec![]),
            ],
        };
        let outline = ApexOutline {
            locals: vec![LocalVar {
                name: "c".to_string(),
                declared_type: "Child".to_string(),
            }],
        };
        let chain = vec![
            Segment {
                name: "c".into(),
                is_call: false,
            },
            Segment {
                name: "self_".into(),
                is_call: true,
            },
        ];
        assert_eq!(
            resolve_expr_type(&ost, &outline, &chain).unwrap().name,
            "Base",
            "inherited method resolves through the parent_class chain"
        );
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
                parent_class: None,
                interfaces: vec![],
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
            parent_class: None,
            interfaces: vec![],
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
            parent_class: None,
            interfaces: vec![],
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
            parent_class: None,
            interfaces: vec![],
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
