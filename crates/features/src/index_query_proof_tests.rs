use super::deletion_tests::{class, fingerprint, seeded};
use super::{index_org, sync_org, NamespacePolicy};
use serde_json::json;
use sf_core::{runner::MockRunner, RawOutput, SfInvoker};
use std::sync::Arc;

fn invoker(target: &'static str, failure: &'static str) -> SfInvoker {
    SfInvoker::new(Arc::new(MockRunner::new(move |_, args: &[String]| {
        let command = args.join(" ");
        let value = if command.contains("SELECT Name, NamespacePrefix FROM") {
            json!({"status":0,"result":{"done":true,"totalSize":1,"records":[{"Name":"Keeper","NamespacePrefix":null}]}})
        } else if command.contains("ApexClass")
            || command.contains("EntityDefinition")
            || command.contains("CustomField")
        {
            let mut result = json!({"done":true,"totalSize":0,"records":[]});
            if command.contains(target) {
                match failure {
                    "pending" => result["done"] = json!(false),
                    "mismatch" => result["totalSize"] = json!(1),
                    "missing" => {
                        result.as_object_mut().unwrap().remove("done");
                        result.as_object_mut().unwrap().remove("totalSize");
                    }
                    _ => panic!("unknown test case"),
                }
            }
            json!({"status":0,"result":result})
        } else if command.contains("sobject list") {
            json!({"status":0,"result":[]})
        } else {
            panic!("unexpected command {command}")
        };
        Ok(RawOutput {
            status: 0,
            stdout: value.to_string(),
            stderr: String::new(),
        })
    })))
}

#[tokio::test]
async fn incomplete_delta_tooling_queries_never_advance_generation_or_watermark() {
    let mut unsafe_results = Vec::new();
    for target in ["ApexClass", "FROM EntityDefinition", "FROM CustomField"] {
        for failure in ["pending", "mismatch", "missing"] {
            let root = seeded("query-proof", vec![class("Keeper", &["Inner"])]).await;
            let before = fingerprint(&root);
            let result = sync_org(
                &invoker(target, failure),
                root.clone(),
                "SyntheticDelta",
                "60.0",
                &NamespacePolicy::All,
            )
            .await;
            if result.is_ok() {
                unsafe_results.push(format!("{target}:{failure}"));
            } else {
                assert_eq!(fingerprint(&root), before);
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    assert!(
        unsafe_results.is_empty(),
        "incomplete queries published: {unsafe_results:?}"
    );
}

#[tokio::test]
async fn full_apex_query_requires_explicit_completion_proof() {
    for failure in ["pending", "mismatch", "missing"] {
        let root = seeded("full-query-proof", vec![class("Keeper", &["Inner"])]).await;
        let before = fingerprint(&root);
        let result = index_org(
            &invoker("ApexClass", failure),
            root.clone(),
            "SyntheticDelta",
            "60.0",
            &NamespacePolicy::All,
            &mut |_| {},
        )
        .await;
        assert!(
            result.is_err(),
            "incomplete full ApexClass {failure} must not publish"
        );
        assert_eq!(fingerprint(&root), before);
        std::fs::remove_dir_all(root).unwrap();
    }
}
