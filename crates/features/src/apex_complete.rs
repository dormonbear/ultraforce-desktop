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
        objects: &[String],
    ) -> Result<Vec<Candidate>, SfError> {
        if let Some((s, e)) = apex_lang::soql_region_at(src, cursor) {
            // SOQL bind variable: cursor sits at `:partial` — offer in-scope
            // Apex variables (locals, params, fields) instead of SOQL fields.
            if is_bind_position(src, s, cursor) {
                return Ok(apex_lang::ast::complete::scope_names_at(src, cursor)
                    .into_iter()
                    .map(|name| Candidate {
                        label: name,
                        kind: CandidateKind::LocalVar,
                    })
                    .collect());
            }
            return self
                .complete_soql(invoker, org_id, &src[s..e], cursor.saturating_sub(s), objects)
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
        Ok(merge_ast(
            src,
            cursor,
            &ost,
            ost_complete(src, cursor, &ost),
        ))
    }

    /// AST-based diagnostics for `src` (duplicate variables + unknown field access
    /// on populated org types). Non-blocking: uses the in-memory OST if the org is
    /// indexed, else an empty OST (duplicate-variable checks still run).
    pub fn diagnostics(&self, org_id: &str, src: &str) -> Vec<ApexDiagnostic> {
        let ost = self
            .cached(org_id)
            .map(|a| (*a).clone())
            .unwrap_or_default();
        let cu = apex_lang::ast::parser::parse(src);
        let mut classes: Vec<&apex_lang::ast::tree::TypeDecl> = Vec::new();
        collect_types(&cu.types, &mut classes);
        let mut out = Vec::new();
        for class in classes {
            for d in apex_lang::ast::diagnostics::diagnose(class, &ost) {
                out.push(ApexDiagnostic {
                    message: d.message,
                    start: d.span.start,
                    end: d.span.end,
                    severity: match d.severity {
                        apex_lang::ast::diagnostics::Severity::Warning => "warning",
                        apex_lang::ast::diagnostics::Severity::Error => "error",
                    }
                    .to_string(),
                });
            }
        }
        out
    }

    /// SOQL field/keyword completion inside an Apex `[SELECT …]` literal. When the
    /// FROM object is unknown (or its describe fails) we still complete against an
    /// empty schema so clause keywords — notably `SELECT` while typing — appear.
    async fn complete_soql(
        &self,
        invoker: &SfInvoker,
        org_id: &str,
        inner: &str,
        rel_cursor: usize,
        objects: &[String],
    ) -> Result<Vec<Candidate>, SfError> {
        let schema = match soql_lang::outline(inner).from_object {
            Some(object) => self.describe_schema(invoker, org_id, &object).await,
            None => None,
        };
        let empty = SObjectSchema::default();
        let schema = schema.as_ref().unwrap_or(&empty);
        let fields = soql_lang::complete(inner, rel_cursor, schema, objects, &|_| None);
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
/// True when `cursor` is at a SOQL bind-variable position: scanning back over an
/// identifier partial within the region lands immediately after a `:`.
fn is_bind_position(src: &str, region_start: usize, cursor: usize) -> bool {
    let bytes = src.as_bytes();
    let mut i = cursor;
    while i > region_start && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_') {
        i -= 1;
    }
    i > region_start && bytes[i - 1] == b':'
}

fn stub_type(name: String) -> ApexType {
    ApexType {
        name,
        kind: TypeKind::Class,
        methods: Vec::new(),
        properties: Vec::new(),
        parent_class: None,
        interfaces: Vec::new(),
        enum_values: Vec::new(),
    }
}

/// True for a stub (no members yet) — i.e. it still needs an on-demand fetch.
fn is_stub_type(ty: &ApexType) -> bool {
    ty.methods.is_empty() && ty.properties.is_empty() && ty.enum_values.is_empty()
}

/// One AST diagnostic for the editor (byte offsets into the source; severity as a
/// lowercase string). Same JSON shape as the SOQL diagnostic DTO.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApexDiagnostic {
    pub message: String,
    pub start: usize,
    pub end: usize,
    pub severity: String,
}

/// Flatten top-level + nested type declarations.
fn collect_types<'a>(
    types: &'a [apex_lang::ast::tree::TypeDecl],
    out: &mut Vec<&'a apex_lang::ast::tree::TypeDecl>,
) {
    for t in types {
        out.push(t);
        for m in &t.members {
            if let apex_lang::ast::tree::Member::Nested(n) = m {
                collect_types(std::slice::from_ref(n), out);
            }
        }
    }
}

/// Merge the AST engine's type-aware candidates into the heuristic results
/// (additive — the heuristic wins on label collisions). The heuristic stays the
/// baseline; the AST adds chain/collection-aware members it can't reach (e.g.
/// `list.get(0).Owner.`). Requires full-source input with the cursor inside a
/// method body, which is what the editor sends; for bare snippets the AST engine
/// finds no enclosing method and contributes nothing.
fn merge_ast(src: &str, cursor: usize, ost: &Ost, mut base: Vec<Candidate>) -> Vec<Candidate> {
    use apex_lang::ast::complete::{complete as ast_complete, CandidateKind as AstKind};
    let mut seen: std::collections::HashSet<String> =
        base.iter().map(|c| c.label.to_ascii_lowercase()).collect();
    for a in ast_complete(src, cursor, ost) {
        if seen.insert(a.label.to_ascii_lowercase()) {
            let kind = match a.kind {
                AstKind::Field => CandidateKind::Property,
                AstKind::Method => CandidateKind::Method,
                AstKind::Variable => CandidateKind::LocalVar,
            };
            base.push(Candidate {
                label: a.label,
                kind,
            });
        }
    }
    base
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
        parent_class: None,
        interfaces: Vec::new(),
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
}
