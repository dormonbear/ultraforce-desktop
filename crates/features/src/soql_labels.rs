//! Column-label resolution for the result table's API-name ↔ label toggle.
//!
//! Best-effort by design: anything unresolvable (no FROM object, describe
//! failure, unknown field/relationship) is simply omitted from the maps and
//! the UI falls back to API names.

use std::collections::HashMap;
use std::path::PathBuf;

use sf_core::SfInvoker;

/// Display labels for one query result: parent columns plus, per subquery
/// relationship, the child object's label and its column labels.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ColumnLabels {
    /// Result column (possibly dotted path) → leaf field label.
    pub parent: HashMap<String, String>,
    /// Relationship name → child labels.
    pub children: HashMap<String, ChildLabels>,
}

/// Labels for one child relationship's mini-table.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ChildLabels {
    /// Display label for the relationship (child object's plural label).
    pub label: Option<String>,
    /// Child column (possibly dotted path) → leaf field label.
    pub columns: HashMap<String, String>,
}

/// Resolve display labels for `query`'s result columns against the schema
/// index. `columns` are the parent result columns; `child_columns` maps each
/// subquery relationship name to its child-table columns.
pub async fn column_labels(
    invoker: &SfInvoker,
    root: impl Into<PathBuf>,
    org_id: &str,
    query: &str,
    columns: &[String],
    child_columns: &HashMap<String, Vec<String>>,
) -> ColumnLabels {
    let mut out = ColumnLabels::default();
    let Some(object) = soql_lang::outline(query).from_object else {
        return out;
    };
    let mut store = sf_schema::SchemaStore::new(root, org_id);
    let api = crate::api_version::api_version_for(invoker, org_id).await;
    let Ok(root_schema) = store.get_or_fetch(invoker, &api, &object).await else {
        return out;
    };

    for col in columns {
        if let Some(label) =
            resolve_path_label(&mut store, invoker, &api, &root_schema, col).await
        {
            out.parent.insert(col.clone(), label);
        }
    }

    for (rel, cols) in child_columns {
        let Some(cr) = root_schema.child_relationship(rel) else {
            continue;
        };
        let child_object = cr.child_sobject.clone();
        let Ok(child_schema) = store.get_or_fetch(invoker, &api, &child_object).await
        else {
            continue;
        };
        let mut labels = ChildLabels {
            label: non_empty(child_schema.label_plural.clone()),
            columns: HashMap::new(),
        };
        for col in cols {
            if let Some(label) =
                resolve_path_label(&mut store, invoker, &api, &child_schema, col).await
            {
                labels.columns.insert(col.clone(), label);
            }
        }
        out.children.insert(rel.clone(), labels);
    }
    out
}

/// Resolve a possibly dotted column path to its leaf field's label. Matching
/// mirrors the completion engine (`soql::resolve_related`): case-insensitive
/// `relationshipName` per hop, first `referenceTo` target for polymorphic
/// lookups — but tracks the FINAL hop so `Account.Owner.Name` reads the label
/// from User rather than any intermediate object.
async fn resolve_path_label(
    store: &mut sf_schema::SchemaStore,
    invoker: &SfInvoker,
    api: &str,
    from: &sf_schema::SObjectSchema,
    path: &str,
) -> Option<String> {
    let segs: Vec<&str> = path.split('.').collect();
    let mut cur = from.clone();
    for seg in &segs[..segs.len() - 1] {
        let field = cur.fields.iter().find(|f| {
            f.relationship_name
                .as_deref()
                .is_some_and(|r| r.eq_ignore_ascii_case(seg))
        })?;
        let target = field.reference_to.first()?.clone();
        cur = store.get_or_fetch(invoker, api, &target).await.ok()?;
    }
    non_empty(cur.field(segs.last()?)?.label.clone())
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// MockRunner that serves per-object describes (keyed by the describe
    /// argument) — same pattern as the completion tests in `soql.rs`.
    fn invoker() -> SfInvoker {
        let runner = sf_core::runner::MockRunner::new(move |_p, args| {
            let body = if args.iter().any(|a| a == "User") {
                r#"{"status":0,"result":{"name":"User","label":"User","labelPlural":"Users","fields":[
                    {"name":"Name","label":"Full Name","type":"string"}]}}"#
            } else if args.iter().any(|a| a == "Contact") {
                r#"{"status":0,"result":{"name":"Contact","label":"Contact","labelPlural":"Contacts (people)","fields":[
                    {"name":"LastName","label":"Last Name","type":"string"},
                    {"name":"OwnerId","label":"Owner ID","type":"reference","referenceTo":["User"],"relationshipName":"Owner"}]}}"#
            } else {
                r#"{"status":0,"result":{"name":"Account","label":"Account","labelPlural":"Accounts","fields":[
                    {"name":"Id","label":"Account ID","type":"id"},
                    {"name":"Name","label":"Account Name","type":"string"},
                    {"name":"OwnerId","label":"Owner ID","type":"reference","referenceTo":["User"],"relationshipName":"Owner"}],
                  "childRelationships":[{"childSObject":"Contact","field":"AccountId","relationshipName":"Contacts"}]}}"#
            };
            Ok(sf_core::RawOutput {
                status: 0,
                stdout: body.to_string(),
                stderr: String::new(),
            })
        });
        SfInvoker::new(std::sync::Arc::new(runner))
    }

    fn tmp(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("soql-labels-{tag}-{}", std::process::id()))
    }

    #[tokio::test]
    async fn resolves_plain_dotted_and_unknown_parent_columns() {
        let dir = tmp("parent");
        let cols = vec!["Name".into(), "Owner.Name".into(), "Bogus__c".into()];
        let got = column_labels(
            &invoker(),
            &dir,
            "myorg",
            "SELECT Name, Owner.Name FROM Account",
            &cols,
            &HashMap::new(),
        )
        .await;
        assert_eq!(got.parent.get("Name").map(String::as_str), Some("Account Name"));
        // Dotted path traverses Owner → User and reads the LEAF label.
        assert_eq!(got.parent.get("Owner.Name").map(String::as_str), Some("Full Name"));
        // Unknown fields are omitted (frontend falls back to the API name).
        assert!(!got.parent.contains_key("Bogus__c"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn resolves_child_columns_through_the_relationship() {
        let dir = tmp("child");
        let child_columns = HashMap::from([(
            "Contacts".to_string(),
            vec!["LastName".into(), "Owner.Name".into(), "Nope".into()],
        )]);
        let got = column_labels(
            &invoker(),
            &dir,
            "myorg",
            "SELECT Id, (SELECT LastName FROM Contacts) FROM Account",
            &[],
            &child_columns,
        )
        .await;
        let contacts = got.children.get("Contacts").expect("Contacts resolved");
        assert_eq!(contacts.label.as_deref(), Some("Contacts (people)"));
        assert_eq!(
            contacts.columns.get("LastName").map(String::as_str),
            Some("Last Name")
        );
        // Dotted child column traverses from the CHILD object.
        assert_eq!(
            contacts.columns.get("Owner.Name").map(String::as_str),
            Some("Full Name")
        );
        assert!(!contacts.columns.contains_key("Nope"));
        // Unknown relationships are omitted entirely.
        assert!(!got.children.contains_key("Ghosts"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn no_from_object_yields_empty_maps() {
        let dir = tmp("nofrom");
        let got = column_labels(
            &invoker(),
            &dir,
            "myorg",
            "SELECT",
            &["Name".into()],
            &HashMap::new(),
        )
        .await;
        assert!(got.parent.is_empty());
        assert!(got.children.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
