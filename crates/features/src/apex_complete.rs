//! Wire apex-lang completion into a stateful, org-keyed in-memory OST cache.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use apex_lang::acquire::{fetch_apex_class, fetch_apex_class_names, parse_org_types, parse_stdlib};
use apex_lang::complete::{complete as ost_complete, Candidate, CandidateKind};
use apex_lang::resolve::resolve_type;
use apex_lang::store::{OstSource, OstStore};
use apex_lang::symbols::{ApexType, Method, Ost, Property, TypeKind};
use sf_core::{SfError, SfInvoker};
use sf_schema::{SObjectSchema, SchemaStore};

pub fn default_index_root() -> PathBuf {
    OstStore::default_root()
}

/// Common Apex SObject instance methods (name, return type). Curated subset -- not exhaustive.
/// ponytail: extend the list if a needed builtin is missing; not worth modelling the full surface.
const SOBJECT_METHODS: &[(&str, &str)] = &[
    ("get", "Object"),
    ("put", "Object"),
    ("getSObjectType", "Schema.SObjectType"),
    ("getSObject", "SObject"),
    ("getSObjects", "List<SObject>"),
    ("getPopulatedFieldsAsMap", "Map<String,Object>"),
    ("getErrors", "List<Database.Error>"),
    ("hasErrors", "Boolean"),
    ("isClone", "Boolean"),
    ("addError", "void"),
    ("clone", "SObject"),
];

/// Owns the assembled-OST cache (one `Arc<Ost>` per org id). The mutex guards only the
/// cheap swap of the cached pointer -- it is NEVER held across an `.await`.
pub struct ApexCompleter {
    root: PathBuf,
    cache: Mutex<Option<(String, Arc<Ost>)>>,
    indexed: Mutex<HashSet<String>>,
}

impl ApexCompleter {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            cache: Mutex::new(None),
            indexed: Mutex::new(Default::default()),
        }
    }

    /// OST root under the OS cache dir, mirroring apex-lang's default.
    pub fn with_default_root() -> Self {
        Self::new(OstStore::default_root())
    }

    fn cached(&self, org_id: &str) -> Option<Arc<Ost>> {
        let guard = self.cache.lock().unwrap();
        match &*guard {
            Some((id, ost)) if id == org_id => Some(ost.clone()),
            _ => None,
        }
    }

    /// True once a full snapshot has been installed/loaded for `org_id`.
    fn is_indexed(&self, org_id: &str) -> bool {
        self.indexed.lock().unwrap().contains(org_id)
    }

    /// Store a freshly-built full index and mark the org indexed.
    pub fn install_index(&self, org_id: &str, ost: Ost) {
        *self.cache.lock().unwrap() = Some((org_id.to_string(), Arc::new(ost)));
        self.indexed.lock().unwrap().insert(org_id.to_string());
    }

    /// Build (or reuse) the OST for `org_id`, then complete at `cursor`.
    pub async fn complete(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        src: &str,
        cursor: usize,
    ) -> Result<Vec<Candidate>, SfError> {
        if let Some((s, e)) = apex_lang::soql_region_at(src, cursor) {
            return self
                .complete_soql(invoker, org_id, &src[s..e], cursor.saturating_sub(s))
                .await;
        }

        let ost = self.ensure_base(invoker, org_id).await?;
        // On-demand acquisition: if the cursor needs a type the base OST (stdlib)
        // lacks, fetch JUST that type — an sObject describe first, then a single
        // Apex class. Both are bounded to one type, so this scales to large orgs
        // (we never bulk-fetch every class).
        if !self.is_indexed(org_id) {
            if let Some(type_name) = apex_lang::needed_type_at(src, cursor) {
                // Fetch when the type is unknown OR is a members-less stub (so a
                // top-level-named org class upgrades to its full SymbolTable here).
                if resolve_type(&ost, &type_name).is_none_or(is_stub_type) {
                    if let Some(apex_ty) = self.describe_sobject(invoker, org_id, &type_name).await
                    {
                        let augmented = self.augment_types(org_id, vec![apex_ty]);
                        return Ok(ost_complete(src, cursor, &augmented));
                    }
                    let classes = self.fetch_org_class(invoker, org_id, &type_name).await;
                    if !classes.is_empty() {
                        let augmented = self.augment_types(org_id, classes);
                        return Ok(ost_complete(src, cursor, &augmented));
                    }
                }
            }
        }
        Ok(ost_complete(src, cursor, &ost))
    }

    /// SOQL field completion inside an Apex `[SELECT …]` literal. Empty when there is no FROM object
    /// or its describe fails (benign).
    async fn complete_soql(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        inner: &str,
        rel_cursor: usize,
    ) -> Result<Vec<Candidate>, SfError> {
        let Some(object) = soql_lang::outline(inner).from_object else {
            return Ok(Vec::new());
        };
        let Some(schema) = self.describe_schema(invoker, org_id, &object).await else {
            return Ok(Vec::new());
        };
        let fields = soql_lang::complete(inner, rel_cursor, &schema, &[], &|_| None);
        Ok(fields
            .into_iter()
            .map(|c| Candidate {
                label: c.label,
                kind: CandidateKind::Property,
            })
            .collect())
    }

    /// Pre-build the base OST (stdlib) for `org_id` so the first interactive
    /// completion does not block on the one-time multi-megabyte stdlib fetch.
    /// Safe to call fire-and-forget when an org is selected.
    pub async fn warm(&self, invoker: &SfInvoker, org_id: &str) -> Result<(), SfError> {
        self.ensure_base(invoker, org_id).await.map(|_| ())
    }

    async fn ensure_base(&self, invoker: &SfInvoker, org_id: &str) -> Result<Arc<Ost>, SfError> {
        if let Some(ost) = self.cached(org_id) {
            return Ok(ost);
        }
        let api = crate::api_version::api_version_for(invoker, org_id).await;
        if let Some((ost, _)) = apex_lang::load_snapshot(&self.root, org_id, &api) {
            let arc = Arc::new(ost);
            *self.cache.lock().unwrap() = Some((org_id.to_string(), arc.clone()));
            self.indexed.lock().unwrap().insert(org_id.to_string());
            return Ok(arc);
        }
        let ost = Arc::new(self.build(invoker, org_id).await?);
        *self.cache.lock().unwrap() = Some((org_id.to_string(), ost.clone()));
        Ok(ost)
    }

    /// On-demand fetch + parse of a single org Apex class (and its inner types).
    /// Empty when the name is not an Apex class or the query fails (benign).
    async fn fetch_org_class(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        name: &str,
    ) -> Vec<ApexType> {
        match fetch_apex_class(invoker, org_id, name).await {
            Ok(records) if !records.is_empty() => parse_org_types(&records),
            _ => Vec::new(),
        }
    }

    /// Best-effort describe (None if the name is not a real sObject or describe fails -- benign).
    async fn describe_sobject(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        name: &str,
    ) -> Option<ApexType> {
        self.describe_schema(invoker, org_id, name)
            .await
            .map(|s| schema_to_apex_type(&s))
    }

    /// Best-effort raw describe (None if not a real sObject / describe fails).
    async fn describe_schema(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        object: &str,
    ) -> Option<SObjectSchema> {
        let api = crate::api_version::api_version_for(invoker, org_id).await;
        let mut store = SchemaStore::new(self.root.clone(), org_id);
        store.get_or_fetch(invoker, &api, object).await.ok()
    }

    /// Insert `tys` into the cached OST's org_types (dedupe by name); returns the new Arc.
    /// Lock not held across any await (this fn is sync).
    fn augment_types(&self, org_id: &str, tys: Vec<ApexType>) -> Arc<Ost> {
        let mut guard = self.cache.lock().unwrap();
        let mut ost = match &*guard {
            Some((id, ost)) if id == org_id => (**ost).clone(),
            _ => Ost::default(),
        };
        for ty in tys {
            // Replace any same-name entry (e.g. upgrade a name-only stub to the
            // fully-fetched type); otherwise append.
            ost.org_types
                .retain(|t| !t.name.eq_ignore_ascii_case(&ty.name));
            ost.org_types.push(ty);
        }
        let arc = Arc::new(ost);
        *guard = Some((org_id.to_string(), arc.clone()));
        arc
    }

    async fn build(&self, invoker: &SfInvoker, org_id: &str) -> Result<Ost, SfError> {
        // Fresh disk-backed store each rebuild; the disk cache makes repeat builds cheap.
        let api = crate::api_version::api_version_for(invoker, org_id).await;
        let mut store = OstStore::new(self.root.clone(), org_id);
        // get_or_fetch returns an OWNED Value -- do NOT add `.clone()` (clippy redundant_clone).
        let stdlib = store.get_or_fetch(invoker, &api, OstSource::Stdlib).await?;
        let namespaces = parse_stdlib(&stdlib);
        // Top-level org-class-name completion is cheap: a names-only query (no
        // SymbolTable) builds stub types. Each class's MEMBERS load lazily on
        // member access (see `complete` / `fetch_org_class`), so we never bulk
        // fetch every class's symbol table.
        let org_types = fetch_apex_class_names(invoker, org_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(stub_type)
            .collect();
        Ok(Ost {
            namespaces,
            org_types,
        })
    }
}

/// A member-less placeholder for an org Apex class (top-level name completion
/// only). Replaced by the full type when its members are fetched on demand.
fn stub_type(name: String) -> ApexType {
    ApexType {
        name,
        kind: TypeKind::Class,
        methods: Vec::new(),
        properties: Vec::new(),
        enum_values: Vec::new(),
    }
}

/// True for a stub (no members yet) — i.e. it still needs an on-demand fetch.
fn is_stub_type(ty: &ApexType) -> bool {
    ty.methods.is_empty() && ty.properties.is_empty() && ty.enum_values.is_empty()
}

/// Salesforce describe `field.type` -> the Apex type name used in completion.
fn apex_field_type(f: &sf_schema::model::Field) -> String {
    match f.field_type.as_str() {
        "id" => "Id",
        "boolean" => "Boolean",
        "int" => "Integer",
        "double" | "currency" | "percent" => "Decimal",
        "date" => "Date",
        "datetime" => "Datetime",
        "time" => "Time",
        "base64" => "Blob",
        "reference" => {
            return f
                .reference_to
                .first()
                .cloned()
                .unwrap_or_else(|| "Id".into())
        }
        // string, textarea, phone, url, email, picklist, multipicklist, encryptedstring, combobox, ...
        _ => "String",
    }
    .to_string()
}

/// Map an sObject describe to an OST ApexType: fields -> instance properties (+ relationship props).
pub(crate) fn schema_to_apex_type(schema: &SObjectSchema) -> ApexType {
    let mut properties = Vec::new();
    for f in &schema.fields {
        properties.push(Property {
            name: f.name.clone(),
            prop_type: apex_field_type(f),
            is_static: false,
        });
        if let (Some(rel), Some(parent)) = (f.relationship_name.clone(), f.reference_to.first()) {
            properties.push(Property {
                name: rel,
                prop_type: parent.clone(),
                is_static: false,
            });
        }
    }
    let methods = SOBJECT_METHODS
        .iter()
        .map(|(name, ret)| Method {
            name: (*name).to_string(),
            return_type: (*ret).to_string(),
            params: Vec::new(),
            is_static: false,
        })
        .collect();
    ApexType {
        name: schema.name.clone(),
        kind: TypeKind::Class,
        methods,
        properties,
        enum_values: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
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
            .complete(&invoker, "myorg", "String.va", 9)
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
            .complete(&invoker, "myorg", "Stri", 4)
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
            .complete(&invoker, "myorg", input, input.len())
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
            .complete(&invoker, "myorg", src, src.len())
            .await
            .unwrap();
        assert!(
            got.iter().any(|c| c.label == "Name"),
            "offline member completion: {got:?}"
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
            .complete(&invoker, "myorg", "Fo", 2)
            .await
            .unwrap();
        assert!(top.iter().any(|c| c.label == "Foo"), "stub name: {top:?}");

        // Member access upgrades the stub and surfaces its static method.
        let input = "Foo.ba";
        let got = completer
            .complete(&invoker, "myorg", input, input.len())
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
            .complete(&invoker, "myorg", src, cursor)
            .await
            .unwrap();
        assert!(got.iter().any(|c| c.label == "Name"), "{got:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
