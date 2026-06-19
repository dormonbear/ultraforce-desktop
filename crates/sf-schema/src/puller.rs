//! Pulls a single object's describe from the live org via sf-core.

use crate::model::SObjectSchema;
use sf_core::{SfError, SfInvoker};

/// Describe a single object: `sf sobject describe -s <object> --json`.
pub async fn describe_object(
    invoker: &SfInvoker,
    object: &str,
) -> Result<SObjectSchema, SfError> {
    invoker
        .run_json(&["sobject", "describe", "-s", object])
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_core::runner::MockRunner;
    use std::sync::{Arc, Mutex};

    const FIXTURE: &str = include_str!("../tests/fixtures/describe_account.json");

    #[tokio::test]
    async fn describe_object_parses_envelope_and_passes_args() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        let runner = MockRunner::new(move |_program, args| {
            *seen2.lock().unwrap() = args.to_vec();
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: FIXTURE.to_string(),
                stderr: String::new(),
            })
        });
        let invoker = SfInvoker::new(Arc::new(runner));

        let schema = describe_object(&invoker, "Account").await.unwrap();

        assert_eq!(schema.name, "Account");
        assert_eq!(schema.fields.len(), 5);
        let owner = schema.fields.iter().find(|f| f.name == "OwnerId").unwrap();
        assert_eq!(owner.reference_to, vec!["User".to_string()]);
        assert_eq!(owner.relationship_name, Some("Owner".to_string()));
        let type_field = schema.fields.iter().find(|f| f.name == "Type").unwrap();
        assert!(!type_field.picklist_values.is_empty());
        assert_eq!(schema.child_relationships.len(), 2);

        let args = seen.lock().unwrap().clone();
        assert_eq!(
            args,
            vec!["sobject", "describe", "-s", "Account", "--json"]
        );
    }
}
