//! Tests for `apex_complete` (split out to keep the main file under the line cap).

use super::*;
use sf_core::runner::MockRunner;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

// Minimal real-shape payloads (see apex-lang fixtures for the full shape).
const STDLIB: &str = r#"{"publicDeclarations":{"System":{"String":{"constructors":[],"methods":[{"name":"valueOf","returnType":"String","isStatic":true,"argTypes":["Integer"],"parameters":[{"name":"i","type":"Integer"}]}],"properties":[]}}}}"#;
const ORGTYPES: &str = r#"{"status":0,"result":{"records":[],"totalSize":0,"done":true}}"#;

#[test]
fn schema_to_apex_type_includes_sobject_instance_methods() {
    let schema: SObjectSchema = serde_json::from_str(
        r#"{"name":"Account","fields":[{"name":"Name","type":"string"}]}"#,
    )
    .unwrap();
    let ty = schema_to_apex_type(&schema);
    assert!(
        ty.properties.iter().any(|p| p.name == "Name"),
        "fields kept"
    );
    assert!(ty.methods.iter().any(|m| m.name == "getSObjectType"));
    assert!(ty.methods.iter().any(|m| m.name == "put"));
    assert!(ty.methods.iter().any(|m| m.name == "get"));
    assert!(ty.methods.iter().all(|m| !m.is_static), "instance methods");
}

/// Counting runner: stdlib `api request rest` (raw, NO --json) then `data query` (--json).
fn counting(seen: Arc<AtomicUsize>) -> MockRunner {
    MockRunner::new(move |_p, args| {
        seen.fetch_add(1, Ordering::SeqCst);
        let is_completions = args.iter().any(|a| a.contains("tooling/completions"));
        let body = if is_completions { STDLIB } else { ORGTYPES };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: body.to_string(),
            stderr: String::new(),
        })
    })
}

#[tokio::test]
async fn completes_stdlib_type_and_caches() {
    let seen = Arc::new(AtomicUsize::new(0));
    let invoker = sf_core::SfInvoker::new(Arc::new(counting(seen.clone())));
    let dir = std::env::temp_dir().join(format!("apex-complete-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());

    let c1 = completer
        .complete(&invoker, "myorg", "String.va", 9, &[])
        .await
        .unwrap();
    assert!(c1.iter().any(|c| c.label == "valueOf"), "{c1:?}");
    let calls_after_first = seen.load(Ordering::SeqCst);
    assert!(
        calls_after_first >= 2,
        "expected api-version + stdlib fetch, got {calls_after_first}"
    );

    // Second call, same org -> served from the in-memory Ost, no new sf calls.
    let c2 = completer
        .complete(&invoker, "myorg", "Stri", 4, &[])
        .await
        .unwrap();
    assert!(c2.iter().any(|c| c.label == "String"), "{c2:?}");
    assert_eq!(
        seen.load(Ordering::SeqCst),
        calls_after_first,
        "second call must not re-fetch"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn completes_sobject_field_via_on_demand_describe() {
    // Dispatch by command (robust to call order + the process-wide api_version
    // cache): org display -> api version, api request -> stdlib, sobject
    // describe -> Account fields. The base build no longer bulk-fetches org
    // Apex classes, so an sObject describe is the only on-demand call here.
    let runner = MockRunner::new(move |_p, args| {
        let joined = args.join(" ");
        let body = if joined.contains("display") {
            r#"{"status":0,"result":{"apiVersion":"67.0"}}"#
        } else if joined.contains("request") || joined.contains("completions") {
            r#"{"publicDeclarations":{"System":{}}}"#
        } else if joined.contains("describe") || joined.contains("sobject") {
            r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"AccountId","type":"reference","referenceTo":["Account"],"relationshipName":"Parent"}]}}"#
        } else {
            "{}"
        };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: body.to_string(),
            stderr: String::new(),
        })
    });
    let invoker = sf_core::SfInvoker::new(Arc::new(runner));
    let dir = std::env::temp_dir().join(format!("apex-sobj-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());

    let input = "Account a; a.Na";
    let got = completer
        .complete(&invoker, "myorg", input, input.len(), &[])
        .await
        .unwrap();
    assert!(got.iter().any(|c| c.label == "Name"), "{got:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn indexed_completion_makes_no_sf_calls() {
    use apex_lang::symbols::{ApexType, Ost, Property};
    let dir = std::env::temp_dir().join(format!("idx-off-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());
    let acct = ApexType {
        name: "Account".into(),
        properties: vec![Property {
            name: "Name".into(),
            ..Default::default()
        }],
        ..Default::default()
    };
    completer.install_index(
        "myorg",
        Ost {
            namespaces: vec![],
            org_types: vec![acct],
        },
    );

    let panicking =
        sf_core::runner::MockRunner::new(|_p, _a| panic!("no SF call when indexed"));
    let invoker = SfInvoker::new(std::sync::Arc::new(panicking));
    let src = "Account a; a.";
    let got = completer
        .complete(&invoker, "myorg", src, src.len(), &[])
        .await
        .unwrap();
    assert!(
        got.iter().any(|c| c.label == "Name"),
        "offline member completion: {got:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn apex_diagnostics_flags_duplicate_and_unknown_field() {
    use apex_lang::symbols::{ApexType, Ost, Property};
    let dir = std::env::temp_dir().join(format!("apex-diag-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());
    completer.install_index(
        "myorg",
        Ost {
            namespaces: vec![],
            org_types: vec![ApexType {
                name: "Account".into(),
                properties: vec![Property {
                    name: "Name".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }],
        },
    );
    let src = "class C { void m(Account a) { Integer x = 1; String x = a.Bogus; } }";
    let diags = completer.diagnostics("myorg", src);
    assert!(
        diags
            .iter()
            .any(|d| d.message.contains("Duplicate variable")),
        "{diags:?}"
    );
    assert!(
        diags
            .iter()
            .any(|d| d.message.contains("Unknown member 'Bogus'")),
        "{diags:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn ast_engine_adds_collection_chain_member_completion() {
    // The AST engine resolves `ls.get(0).Owner.` through a collection element +
    // relationship chain — something the heuristic alone can't infer. Full-source
    // input (as the editor sends) with the cursor inside a method body.
    use apex_lang::symbols::{ApexType, Method, Ost, Property};
    let dir = std::env::temp_dir().join(format!("ast-chain-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());
    let account = ApexType {
        name: "Account".into(),
        properties: vec![Property {
            name: "Owner".into(),
            prop_type: "User".into(),
            is_static: false,
        }],
        ..Default::default()
    };
    let user = ApexType {
        name: "User".into(),
        methods: vec![Method {
            name: "getName".into(),
            return_type: "String".into(),
            ..Default::default()
        }],
        properties: vec![Property {
            name: "Email".into(),
            prop_type: "String".into(),
            is_static: false,
        }],
        ..Default::default()
    };
    completer.install_index(
        "myorg",
        Ost {
            namespaces: vec![],
            org_types: vec![account, user],
        },
    );
    let invoker = SfInvoker::new(std::sync::Arc::new(MockRunner::new(|_p, _a| {
        panic!("no SF call when indexed")
    })));
    let src = "class C { void m(List<Account> ls) { ls.get(0).Owner.Em } }";
    let cursor = src.find("Em }").unwrap() + 2;
    let got = completer
        .complete(&invoker, "myorg", src, cursor, &[])
        .await
        .unwrap();
    assert!(
        got.iter().any(|c| c.label == "Email"),
        "AST collection-chain completion: {got:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn upgrades_org_class_stub_via_on_demand_member_fetch() {
    // Base OST gets a NAME-only stub for class `Foo`; accessing a member
    // upgrades it to the full SymbolTable on demand. Dispatch by command so
    // the names query and the single-class query are distinguished.
    let runner = MockRunner::new(move |_p, args| {
        let joined = args.join(" ");
        let body = if joined.contains("display") {
            r#"{"status":0,"result":{"apiVersion":"67.0"}}"#
        } else if joined.contains("request") || joined.contains("completions") {
            r#"{"publicDeclarations":{}}"#
        } else if joined.contains("SymbolTable") {
            // Single-class fetch -> full type with a static `bar`.
            r#"{"status":0,"result":{"records":[{"Name":"Foo","SymbolTable":{"name":"Foo","methods":[{"name":"bar","modifiers":["static"],"returnType":"void","parameters":[]}]}}],"totalSize":1,"done":true}}"#
        } else if joined.contains("ApexClass") {
            // Names-only fetch -> one stub.
            r#"{"status":0,"result":{"records":[{"Name":"Foo"}],"totalSize":1,"done":true}}"#
        } else {
            // sObject describe for `Foo` fails (it is a class, not an sObject).
            "{}"
        };
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: body.to_string(),
            stderr: String::new(),
        })
    });
    let invoker = sf_core::SfInvoker::new(Arc::new(runner));
    let dir = std::env::temp_dir().join(format!("apex-stub-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());

    // Top-level: the stub name is offered.
    let top = completer
        .complete(&invoker, "myorg", "Fo", 2, &[])
        .await
        .unwrap();
    assert!(top.iter().any(|c| c.label == "Foo"), "stub name: {top:?}");

    // Member access upgrades the stub and surfaces its static method.
    let input = "Foo.ba";
    let got = completer
        .complete(&invoker, "myorg", input, input.len(), &[])
        .await
        .unwrap();
    assert!(
        got.iter().any(|c| c.label == "bar"),
        "upgraded member: {got:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn completes_soql_field_inside_apex_literal() {
    let body = r#"{"status":0,"result":{"name":"Account","fields":[{"name":"Name","type":"string"},{"name":"Industry","type":"picklist"}]}}"#;
    let runner = MockRunner::new(move |_p, _args| {
        Ok(sf_core::RawOutput {
            status: 0,
            stdout: body.to_string(),
            stderr: String::new(),
        })
    });
    let invoker = sf_core::SfInvoker::new(Arc::new(runner));
    let dir = std::env::temp_dir().join(format!("soql-in-apex-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());

    let src = "Account a = [SELECT Na FROM Account];";
    let cursor = src.find("Na").unwrap() + 2;
    let got = completer
        .complete(&invoker, "myorg", src, cursor, &[])
        .await
        .unwrap();
    assert!(got.iter().any(|c| c.label == "Name"), "{got:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn completes_select_keyword_and_from_object_inside_apex_literal() {
    // describe never succeeds here; both completions are schema-free.
    let runner = MockRunner::new(|_p, _a| {
        Ok(sf_core::RawOutput {
            status: 1,
            stdout: r#"{"status":1}"#.to_string(),
            stderr: String::new(),
        })
    });
    let invoker = sf_core::SfInvoker::new(Arc::new(runner));
    let dir = std::env::temp_dir().join(format!("soql-kw-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());
    let objects = vec!["Vendor__c".to_string(), "Account".to_string()];

    // Partial SELECT while typing -> the SELECT keyword.
    let src = "List<Account> l = [\n    SELE\n]";
    let cur = src.find("SELE").unwrap() + 4;
    let got = completer
        .complete(&invoker, "myorg", src, cur, &objects)
        .await
        .unwrap();
    assert!(
        got.iter().any(|c| c.label.eq_ignore_ascii_case("SELECT")),
        "{got:?}"
    );

    // FROM <partial> -> matching sObject names from the org cache.
    let src = "List<Account> l = [SELECT Id FROM Vend]";
    let cur = src.len() - 1;
    let got = completer
        .complete(&invoker, "myorg", src, cur, &objects)
        .await
        .unwrap();
    assert!(got.iter().any(|c| c.label == "Vendor__c"), "{got:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn completes_bind_variable_inside_apex_soql() {
    // Bind completion is schema-free (scope only) — describe can fail.
    let runner = MockRunner::new(|_p, _a| {
        Ok(sf_core::RawOutput {
            status: 1,
            stdout: r#"{"status":1}"#.to_string(),
            stderr: String::new(),
        })
    });
    let invoker = sf_core::SfInvoker::new(Arc::new(runner));
    let dir = std::env::temp_dir().join(format!("bind-var-test-{}", std::process::id()));
    let completer = ApexCompleter::new(dir.clone());

    let src =
        "class C { void m(Id accId) { Account a = [SELECT Id FROM Account WHERE Id = :acc]; } }";
    let cursor = src.find(":acc").unwrap() + ":acc".len();
    let got = completer
        .complete(&invoker, "myorg", src, cursor, &[])
        .await
        .unwrap();
    assert!(
        got.iter()
            .any(|c| c.label == "accId" && c.kind == CandidateKind::LocalVar),
        "bind var should offer in-scope Apex variables: {got:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
