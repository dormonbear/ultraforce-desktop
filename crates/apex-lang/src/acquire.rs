use crate::symbols::{ApexType, Method, Namespace, Property, TypeKind};
use serde::Deserialize;
use serde_json::Value;
use sf_core::{SfError, SfInvoker};
use std::time::Duration;

/// The Tooling completions payload is multi-megabyte (≈18 MB / ~140 s observed)
/// and only fetched once per org+api before being cached to disk, so it needs a
/// far longer bound than the default 120 s.
const COMPLETIONS_TIMEOUT: Duration = Duration::from_secs(300);

/// Append `--target-org <org>` unless `org` is empty or the "default" sentinel
/// (then the CLI's configured default org is used). Keeps OST acquisition pinned
/// to the SELECTED org instead of whatever the CLI default happens to be.
fn with_target<'a>(mut args: Vec<&'a str>, org: &'a str) -> Vec<&'a str> {
    if !org.is_empty() && org != "default" {
        args.push("--target-org");
        args.push(org);
    }
    args
}

pub async fn fetch_completions(
    invoker: &SfInvoker,
    org: &str,
    api_version: &str,
) -> Result<serde_json::Value, SfError> {
    let url = format!("/services/data/v{api_version}/tooling/completions?type=apex");
    let args = with_target(vec!["api", "request", "rest", &url], org);
    let out = invoker
        .run_raw_with_timeout(&args, COMPLETIONS_TIMEOUT)
        .await?;
    serde_json::from_str::<serde_json::Value>(&out.stdout).map_err(SfError::Parse)
}

pub async fn fetch_apex_symbols(
    invoker: &SfInvoker,
    org: &str,
) -> Result<Vec<serde_json::Value>, SfError> {
    #[derive(Deserialize)]
    struct QueryEnvelope {
        records: Vec<serde_json::Value>,
    }

    let args = with_target(
        vec![
            "data",
            "query",
            "--query",
            "SELECT Name, SymbolTable FROM ApexClass",
            "--use-tooling-api",
        ],
        org,
    );
    let env: QueryEnvelope = invoker.run_json(&args).await?;
    Ok(env.records)
}

/// Fetch just the NAMES of every org Apex class (cheap — no `SymbolTable`), for
/// top-level type-name completion. Each class's full members load on demand via
/// [`fetch_apex_class`]. Names-only stays small even on large orgs.
pub async fn fetch_apex_class_names(
    invoker: &SfInvoker,
    org: &str,
) -> Result<Vec<String>, SfError> {
    #[derive(Deserialize)]
    struct Rec {
        #[serde(rename = "Name")]
        name: String,
    }
    #[derive(Deserialize)]
    struct QueryEnvelope {
        records: Vec<Rec>,
    }

    let args = with_target(
        vec![
            "data",
            "query",
            "--query",
            "SELECT Name FROM ApexClass",
            "--use-tooling-api",
        ],
        org,
    );
    let env: QueryEnvelope = invoker.run_json(&args).await?;
    Ok(env.records.into_iter().map(|r| r.name).collect())
}

/// Fetch ONE Apex class's `SymbolTable` on demand (bounded — the scalable
/// alternative to [`fetch_apex_symbols`], which pulls every class in the org).
/// Returns the matching records (0 or 1) to feed [`parse_org_types`].
pub async fn fetch_apex_class(
    invoker: &SfInvoker,
    org: &str,
    name: &str,
) -> Result<Vec<serde_json::Value>, SfError> {
    #[derive(Deserialize)]
    struct QueryEnvelope {
        records: Vec<serde_json::Value>,
    }

    // Class names are bare identifiers; refuse anything with a quote (SOQL-injection safe).
    if name.is_empty() || name.contains('\'') {
        return Ok(Vec::new());
    }
    let q = format!("SELECT Name, SymbolTable FROM ApexClass WHERE Name = '{name}'");
    let args = with_target(
        vec!["data", "query", "--query", &q, "--use-tooling-api"],
        org,
    );
    let env: QueryEnvelope = invoker.run_json(&args).await?;
    Ok(env.records)
}

pub fn parse_stdlib(raw: &serde_json::Value) -> Vec<Namespace> {
    let Some(namespaces) = raw.get("publicDeclarations").and_then(Value::as_object) else {
        return Vec::new();
    };

    namespaces
        .iter()
        .map(|(namespace_name, types)| Namespace {
            name: namespace_name.clone(),
            types: types
                .as_object()
                .map(|type_map| {
                    type_map
                        .iter()
                        .map(|(type_name, raw_type)| ApexType {
                            name: type_name.clone(),
                            kind: TypeKind::Class,
                            methods: parse_stdlib_methods(raw_type),
                            properties: parse_stdlib_properties(raw_type),
                            enum_values: Vec::new(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect()
}

pub fn parse_org_types(records: &[serde_json::Value]) -> Vec<ApexType> {
    let mut entries: Vec<(ApexType, Vec<String>)> = Vec::new();
    for record in records {
        let Some(symbol_table) = record.get("SymbolTable") else {
            continue;
        };
        let fallback = record.get("Name").and_then(Value::as_str);
        collect_symbol_table_types(symbol_table, fallback, &mut entries);
    }
    flatten_inheritance(entries)
}

/// Append the type described by `symbol_table` plus all of its recursively nested inner classes.
fn collect_symbol_table_types(
    symbol_table: &Value,
    name_fallback: Option<&str>,
    out: &mut Vec<(ApexType, Vec<String>)>,
) {
    if let Some(name) = symbol_table
        .get("name")
        .and_then(Value::as_str)
        .or(name_fallback)
    {
        out.push((
            ApexType {
                name: name.to_string(),
                kind: TypeKind::Class,
                methods: parse_org_methods(symbol_table),
                properties: parse_org_properties(symbol_table),
                enum_values: Vec::new(),
            },
            super_types(symbol_table),
        ));
    }

    if let Some(inner) = symbol_table.get("innerClasses").and_then(Value::as_array) {
        for inner_class in inner {
            collect_symbol_table_types(inner_class, None, out);
        }
    }
}

/// All org-supertype names: `parentClass` (if any) followed by `interfaces[]`.
fn super_types(symbol_table: &Value) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(parent) = symbol_table.get("parentClass") {
        if let Some(name) = type_ref_name(parent) {
            names.push(name);
        }
    }
    if let Some(arr) = symbol_table.get("interfaces").and_then(Value::as_array) {
        for iface in arr {
            if let Some(name) = type_ref_name(iface) {
                names.push(name);
            }
        }
    }
    names
}

/// A SymbolTable type reference is either a bare string or an object with `name`.
fn type_ref_name(v: &Value) -> Option<String> {
    let name = v
        .as_str()
        .map(str::to_string)
        .or_else(|| v.get("name").and_then(Value::as_str).map(str::to_string))?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// Simple, generics-stripped, namespace-stripped name for parent lookup.
fn simple_key(name: &str) -> String {
    name.split('<')
        .next()
        .unwrap_or(name)
        .rsplit('.')
        .next()
        .unwrap_or(name)
        .trim()
        .to_ascii_lowercase()
}

/// Merge each type's transitive org supertypes (child wins; cycle-safe).
fn flatten_inheritance(entries: Vec<(ApexType, Vec<String>)>) -> Vec<ApexType> {
    use std::collections::HashMap;

    let index: HashMap<String, usize> = entries
        .iter()
        .enumerate()
        .map(|(i, (ty, _))| (simple_key(&ty.name), i))
        .collect();

    let mut out = Vec::with_capacity(entries.len());
    for i in 0..entries.len() {
        let mut methods = entries[i].0.methods.clone();
        let mut properties = entries[i].0.properties.clone();
        let mut visited = vec![i];
        let mut worklist: Vec<String> = entries[i].1.clone();
        while let Some(super_name) = worklist.pop() {
            let Some(&super_index) = index.get(&simple_key(&super_name)) else {
                continue;
            };
            if visited.contains(&super_index) {
                continue;
            }
            visited.push(super_index);

            for method in &entries[super_index].0.methods {
                if !methods
                    .iter()
                    .any(|existing| existing.name.eq_ignore_ascii_case(&method.name))
                {
                    methods.push(method.clone());
                }
            }
            for property in &entries[super_index].0.properties {
                if !properties
                    .iter()
                    .any(|existing| existing.name.eq_ignore_ascii_case(&property.name))
                {
                    properties.push(property.clone());
                }
            }

            worklist.extend(entries[super_index].1.clone());
        }

        let base = &entries[i].0;
        out.push(ApexType {
            name: base.name.clone(),
            kind: base.kind.clone(),
            methods,
            properties,
            enum_values: base.enum_values.clone(),
        });
    }
    out
}

fn parse_stdlib_methods(raw_type: &Value) -> Vec<Method> {
    raw_type
        .get("methods")
        .and_then(Value::as_array)
        .map(|methods| {
            methods
                .iter()
                .filter_map(|method| {
                    let name = method.get("name")?.as_str()?;
                    Some(Method {
                        name: name.to_string(),
                        return_type: string_field(method, "returnType"),
                        params: stdlib_params(method),
                        is_static: method
                            .get("isStatic")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_stdlib_properties(raw_type: &Value) -> Vec<Property> {
    raw_type
        .get("properties")
        .and_then(Value::as_array)
        .map(|properties| {
            properties
                .iter()
                .filter_map(|property| {
                    let name = property.get("name")?.as_str()?;
                    Some(Property {
                        name: name.to_string(),
                        prop_type: String::new(),
                        is_static: false,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_org_methods(symbol_table: &Value) -> Vec<Method> {
    symbol_table
        .get("methods")
        .and_then(Value::as_array)
        .map(|methods| {
            methods
                .iter()
                .filter_map(|method| {
                    let name = method.get("name")?.as_str()?;
                    Some(Method {
                        name: name.to_string(),
                        return_type: string_field(method, "returnType"),
                        params: parameter_types(method),
                        is_static: modifiers_contain(method, "static"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_org_properties(symbol_table: &Value) -> Vec<Property> {
    symbol_table
        .get("properties")
        .and_then(Value::as_array)
        .map(|properties| {
            properties
                .iter()
                .filter_map(|property| {
                    let name = property.get("name")?.as_str()?;
                    Some(Property {
                        name: name.to_string(),
                        prop_type: string_field(property, "type"),
                        is_static: modifiers_contain(property, "static"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn stdlib_params(method: &Value) -> Vec<String> {
    let arg_types = method
        .get("argTypes")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if arg_types.is_empty() {
        parameter_types(method)
    } else {
        arg_types
    }
}

fn parameter_types(method: &Value) -> Vec<String> {
    method
        .get("parameters")
        .and_then(Value::as_array)
        .map(|params| {
            params
                .iter()
                .filter_map(|param| param.get("type").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn modifiers_contain(value: &Value, modifier: &str) -> bool {
    value
        .get("modifiers")
        .and_then(Value::as_array)
        .map(|modifiers| {
            modifiers
                .iter()
                .filter_map(Value::as_str)
                .any(|item| item.eq_ignore_ascii_case(modifier))
        })
        .unwrap_or(false)
}

fn string_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use sf_core::{RawOutput, SfInvoker};
    use std::sync::{Arc, Mutex};

    const COMPLETIONS: &str = include_str!("../tests/fixtures/completions_apex.json");
    const APEX_CLASS: &str = include_str!("../tests/fixtures/apexclass_symboltable.json");

    #[tokio::test]
    async fn fetch_completions_uses_raw_api_request_without_json_flag() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen_runner = seen.clone();
        let runner = MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            *seen_runner.lock().unwrap() = args.to_vec();
            Ok(RawOutput {
                status: 0,
                stdout: COMPLETIONS.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let raw = fetch_completions(&invoker, "default", "60.0").await.unwrap();

        assert!(raw.get("publicDeclarations").is_some());
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                "api",
                "request",
                "rest",
                "/services/data/v60.0/tooling/completions?type=apex"
            ]
        );
    }

    #[tokio::test]
    async fn fetch_apex_symbols_uses_tooling_query_json_envelope() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen_runner = seen.clone();
        let runner = MockRunner::new(move |program, args| {
            assert_eq!(program, "sf");
            *seen_runner.lock().unwrap() = args.to_vec();
            Ok(RawOutput {
                status: 0,
                stdout: APEX_CLASS.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let records = fetch_apex_symbols(&invoker, "default").await.unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(
            *seen.lock().unwrap(),
            vec![
                "data",
                "query",
                "--query",
                "SELECT Name, SymbolTable FROM ApexClass",
                "--use-tooling-api",
                "--json"
            ]
        );
    }

    #[test]
    fn parse_stdlib_maps_real_completions_shape() {
        let raw: serde_json::Value = serde_json::from_str(COMPLETIONS).unwrap();

        let namespaces = parse_stdlib(&raw);

        let system = namespaces.iter().find(|ns| ns.name == "System").unwrap();
        assert!(system.types.iter().any(|ty| ty.name == "String"));
    }

    #[test]
    fn parse_org_types_maps_symbol_table_records() {
        let envelope: serde_json::Value = serde_json::from_str(APEX_CLASS).unwrap();
        let records = envelope["result"]["records"].as_array().unwrap();

        let types = parse_org_types(records);

        assert_eq!(types.len(), 3);
        let by_name = |name: &str| types.iter().find(|ty| ty.name == name);
        let outer = by_name("AccountService").expect("outer");
        assert_eq!(outer.methods[0].name, "save");
        assert!(!outer.methods[0].is_static);
        assert_eq!(outer.methods[0].params, vec!["Account"]);
        assert_eq!(outer.properties[0].name, "lastError");
        assert_eq!(outer.properties[0].prop_type, "String");
        assert!(!outer.properties[0].is_static);

        let inner = by_name("LineItem").expect("inner class");
        assert!(inner.methods.iter().any(|method| method.name == "total"));
        assert!(inner
            .properties
            .iter()
            .any(|property| property.name == "quantity"));

        let premium = by_name("PremiumAccountService").expect("subclass");
        assert!(
            premium
                .methods
                .iter()
                .any(|method| method.name == "upgrade"),
            "own method"
        );
        assert!(
            premium.methods.iter().any(|method| method.name == "save"),
            "inherited from AccountService"
        );
    }

    #[test]
    fn parse_org_types_flattens_implemented_interface_members() {
        let records = vec![
            serde_json::json!({
                "Name": "Payable",
                "SymbolTable": {
                    "name": "Payable",
                    "methods": [{ "name": "pay", "returnType": "void", "modifiers": [] }]
                }
            }),
            serde_json::json!({
                "Name": "Invoice",
                "SymbolTable": {
                    "name": "Invoice",
                    "interfaces": ["Payable"],
                    "methods": [{ "name": "total", "returnType": "Decimal", "modifiers": [] }]
                }
            }),
        ];
        let types = parse_org_types(&records);
        let invoice = types.iter().find(|t| t.name == "Invoice").expect("Invoice");
        assert!(
            invoice.methods.iter().any(|m| m.name == "total"),
            "own method"
        );
        assert!(
            invoice.methods.iter().any(|m| m.name == "pay"),
            "interface method"
        );
    }
}
