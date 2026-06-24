# Apex tree-sitter foundation + completion rebuild (P0+P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace apex-lang's text-heuristic completion with tree-sitter-sfapex CST-based position classification, mirroring IC2's PSI approach, keeping the OST symbol model.

**Architecture:** A new `cst` module wraps tree-sitter-sfapex (apex grammar, root `parser_output = repeat(statement)` — handles anonymous Apex and class files). Completion gets the deepest node at the caret, walks ancestors to the nearest known context node (`local_variable_declaration`, `field_access`, `object_creation_expression`, …), and offers candidates for that context. Org types still come from the OST; the CST supplies caret position + local declarations.

**Tech Stack:** Rust, `tree-sitter` 0.26, `tree-sitter-sfapex` 3 (MIT), existing `apex-lang` OST symbol model.

## Global Constraints

- `tree-sitter = "0.26"`, `tree-sitter-sfapex = "3"` (MIT) — exact crates.
- Apex language handle: `tree_sitter_sfapex::apex::LANGUAGE` (a `LanguageFn`); set via `parser.set_language(&tree_sitter_sfapex::apex::LANGUAGE.into())`.
- Root node kind is `parser_output`. Comments are `extras` (`line_comment`/`block_comment`). Inline SOQL/SOSL is a `query_expression` node.
- Public signatures unchanged: `complete(input: &str, cursor: usize, ost: &Ost) -> Vec<Candidate>`; `needed_type_at` and `soql_region_at` stay heuristic (do NOT touch in P1).
- Do NOT modify `symbols.rs`, `acquire.rs`, `store.rs`, `snapshot.rs`, `ast/*`, `resolve.rs` interfaces, `format.rs`. Do NOT change the `apex_complete` Tauri command or Monaco provider.
- Reuse existing helpers in `complete.rs`: `Candidate`, `CandidateKind`, `push_if_matches`, `member_candidates`, `all_types`, `default_var_name`, `decapitalize`, `sort_and_dedupe`, `PRIMITIVES`, `BUILTIN_TYPES`, `ANNOTATIONS`. Reuse `resolve::resolve_type`.
- TDD: every task writes the failing test first. Commit after each task. Commits are unsigned in this environment: use `git commit --no-gpg-sign`.

---

### Task 1: P0 — add tree-sitter deps and `cst::parse`

**Files:**
- Modify: `crates/apex-lang/Cargo.toml`
- Create: `crates/apex-lang/src/cst.rs`
- Modify: `crates/apex-lang/src/lib.rs` (add `pub mod cst;`)

**Interfaces:**
- Produces: `cst::parse(src: &str) -> tree_sitter::Tree`

- [ ] **Step 1: Add dependencies**

In `crates/apex-lang/Cargo.toml` under `[dependencies]` add:
```toml
tree-sitter = "0.26"
tree-sitter-sfapex = "3"
```

- [ ] **Step 2: Write the failing test**

Create `crates/apex-lang/src/cst.rs`:
```rust
//! tree-sitter CST layer for Apex. The apex grammar's root is
//! `parser_output = repeat(statement)`, so the same entry parses anonymous
//! Apex (bare statements) and full class files. Error-tolerant: parse never
//! fails; incomplete input yields a tree with ERROR/MISSING nodes.

use tree_sitter::{Parser, Tree};

/// Parse Apex source into a CST. Never fails for non-cancelled parses.
pub fn parse(src: &str) -> Tree {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_sfapex::apex::LANGUAGE.into())
        .expect("load apex grammar");
    parser.parse(src, None).expect("apex parse returned None")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_anonymous_block() {
        let tree = parse("Integer x = 1; System.debug(x);");
        assert_eq!(tree.root_node().kind(), "parser_output");
        assert!(!tree.root_node().has_error());
    }

    #[test]
    fn parses_class_file() {
        let tree = parse("public class Foo { void bar() {} }");
        assert!(!tree.root_node().has_error());
    }

    #[test]
    fn tolerates_incomplete_declaration() {
        // The spike: `List<Account> accou` while typing must still produce a
        // local_variable_declaration with a `type` field.
        let tree = parse("List<Account> accou");
        let root = tree.root_node();
        // Find the local_variable_declaration anywhere in the tree.
        let mut cursor = root.walk();
        let mut found_type = None;
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "local_variable_declaration" {
                if let Some(t) = n.child_by_field_name("type") {
                    found_type = Some(t.utf8_text("List<Account> accou".as_bytes()).unwrap().to_string());
                }
            }
            for i in 0..n.child_count() {
                stack.push(n.child(i).unwrap());
            }
        }
        let _ = &mut cursor;
        assert_eq!(found_type.as_deref(), Some("List<Account>"));
    }
}
```

Add `pub mod cst;` to `crates/apex-lang/src/lib.rs` (after `pub mod complete;`).

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p apex-lang cst`
Expected: FAIL — dependency not yet resolved / `cst` unresolved until deps fetch. (If it fails to compile because the crate isn't downloaded, run `cargo fetch` first, then re-run.)

- [ ] **Step 4: Build to confirm the C grammar compiles in this workspace**

Run: `cargo build -p apex-lang`
Expected: builds (the tree-sitter C parser compiles via the `cc` build dep). If it fails on a missing C toolchain, STOP and report — this is the P0 build-chain risk gate.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p apex-lang cst`
Expected: PASS (3 tests). The `tolerates_incomplete_declaration` test proves error-tolerant parse + the `local_variable_declaration.type` field survive incomplete input.

- [ ] **Step 6: Verify the Tauri build still links the grammar**

Run: `cargo build -p ultraforce-desktop`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add crates/apex-lang/Cargo.toml crates/apex-lang/src/cst.rs crates/apex-lang/src/lib.rs Cargo.lock
git commit --no-gpg-sign -m "feat(apex-lang): add tree-sitter-sfapex CST parse layer (P0)"
```

---

### Task 2: P0 — CST navigation helpers

**Files:**
- Modify: `crates/apex-lang/src/cst.rs`

**Interfaces:**
- Consumes: `cst::parse`
- Produces:
  - `cst::node_at_offset(tree: &Tree, offset: usize) -> Node`
  - `cst::find_ancestor<'a>(node: Node<'a>, kinds: &[&str]) -> Option<Node<'a>>`
  - `cst::node_text<'a>(node: Node, src: &'a str) -> &'a str`

- [ ] **Step 1: Write the failing test**

Append to `crates/apex-lang/src/cst.rs` (above `#[cfg(test)]` add the functions in Step 3; add these tests inside the existing `mod tests`):
```rust
    #[test]
    fn node_at_offset_lands_in_token() {
        let src = "Integer x = 1;";
        let tree = parse(src);
        // offset at the start of `x`
        let off = src.find('x').unwrap();
        let node = node_at_offset(&tree, off);
        assert!(node.kind() == "identifier");
    }

    #[test]
    fn find_ancestor_walks_up() {
        let src = "void m() { Integer x = 1; }";
        let tree = parse(src);
        let off = src.find("x =").unwrap();
        let node = node_at_offset(&tree, off);
        let decl = find_ancestor(node, &["local_variable_declaration"]);
        assert!(decl.is_some());
        assert_eq!(
            node_text(decl.unwrap().child_by_field_name("type").unwrap(), src),
            "Integer"
        );
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apex-lang cst`
Expected: FAIL — `node_at_offset`/`find_ancestor`/`node_text` not defined.

- [ ] **Step 3: Implement the helpers**

In `crates/apex-lang/src/cst.rs`, change the import to `use tree_sitter::{Node, Parser, Tree};` and add:
```rust
/// The deepest named node containing `offset` (clamped to the source length).
/// Lands inside the token under the caret so callers can read its kind/ancestry.
pub fn node_at_offset(tree: &Tree, offset: usize) -> Node {
    let root = tree.root_node();
    let len = root.end_byte();
    let at = offset.min(len);
    // Bias one byte left at a token's trailing edge so a just-typed identifier
    // resolves to the identifier node, not its parent.
    let probe = if at > 0 { at - 1 } else { at };
    root.named_descendant_for_byte_range(probe, at)
        .or_else(|| root.descendant_for_byte_range(probe, at))
        .unwrap_or(root)
}

/// Walk up from `node` (inclusive) to the nearest ancestor whose kind is in
/// `kinds`.
pub fn find_ancestor<'a>(node: Node<'a>, kinds: &[&str]) -> Option<Node<'a>> {
    let mut cur = Some(node);
    while let Some(n) = cur {
        if kinds.contains(&n.kind()) {
            return Some(n);
        }
        cur = n.parent();
    }
    None
}

/// The source text a node spans.
pub fn node_text<'a>(node: Node, src: &'a str) -> &'a str {
    node.utf8_text(src.as_bytes()).unwrap_or("")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p apex-lang cst`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/apex-lang/src/cst.rs
git commit --no-gpg-sign -m "feat(apex-lang): CST navigation helpers (node_at_offset, find_ancestor)"
```

---

### Task 3: P1 — collect local declarations from the CST

**Files:**
- Create: `crates/apex-lang/src/cst_scope.rs`
- Modify: `crates/apex-lang/src/lib.rs` (add `pub mod cst_scope;`)

**Interfaces:**
- Consumes: `cst::parse`
- Produces: `cst_scope::CstLocal { name: String, declared_type: String }`, and `cst_scope::locals(tree: &Tree, src: &str) -> Vec<CstLocal>`

- [ ] **Step 1: Write the failing test**

Create `crates/apex-lang/src/cst_scope.rs`:
```rust
//! Local variable / parameter declarations harvested from the CST, used to
//! resolve a receiver name to its declared type during completion. Simpler than
//! true scoping: every local_variable_declaration and formal_parameter in the
//! file is collected (good enough for single-method anonymous Apex).

use tree_sitter::Tree;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CstLocal {
    pub name: String,
    pub declared_type: String,
}

/// Collect all local var + parameter declarations in the tree.
pub fn locals(tree: &Tree, src: &str) -> Vec<CstLocal> {
    let mut out = Vec::new();
    let root = tree.root_node();
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        match n.kind() {
            "local_variable_declaration" | "formal_parameter" => {
                if let (Some(ty), Some(name)) =
                    (n.child_by_field_name("type"), declared_name(n))
                {
                    out.push(CstLocal {
                        name: name_text(name, src),
                        declared_type: text(ty, src),
                    });
                }
            }
            _ => {}
        }
        for i in 0..n.child_count() {
            stack.push(n.child(i).unwrap());
        }
    }
    out
}

fn declared_name(n: tree_sitter::Node) -> Option<tree_sitter::Node> {
    // formal_parameter has a `name` field directly; local_variable_declaration
    // wraps a variable_declarator whose `name` field is the identifier.
    if let Some(name) = n.child_by_field_name("name") {
        return Some(name);
    }
    let mut stack = vec![n];
    while let Some(c) = stack.pop() {
        if c.kind() == "variable_declarator" {
            if let Some(name) = c.child_by_field_name("name") {
                return Some(name);
            }
        }
        for i in 0..c.child_count() {
            stack.push(c.child(i).unwrap());
        }
    }
    None
}

fn name_text(node: tree_sitter::Node, src: &str) -> String {
    text(node, src)
}

fn text(node: tree_sitter::Node, src: &str) -> String {
    node.utf8_text(src.as_bytes()).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cst::parse;

    #[test]
    fn collects_local_and_param_types() {
        let src = "void m(Account a) { List<Account> rows = null; }";
        let locs = locals(&parse(src), src);
        assert!(locs.iter().any(|l| l.name == "a" && l.declared_type == "Account"));
        assert!(locs
            .iter()
            .any(|l| l.name == "rows" && l.declared_type == "List<Account>"));
    }
}
```

Add `pub mod cst_scope;` to `lib.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apex-lang cst_scope`
Expected: FAIL — module/functions not yet wired (or assertion fails if field names differ).

- [ ] **Step 3: Make it pass**

The implementation is in Step 1. If the test fails on a field-name mismatch, inspect the actual tree with a scratch print (`eprintln!("{}", tree.root_node().to_sexp())`) and adjust `declared_name` to the real field/kind names, then re-run. Do not change the public signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p apex-lang cst_scope`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/apex-lang/src/cst_scope.rs crates/apex-lang/src/lib.rs
git commit --no-gpg-sign -m "feat(apex-lang): collect CST local/param declarations for completion"
```

---

### Task 4: P1 — `CompletionContext` + `classify`

**Files:**
- Create: `crates/apex-lang/src/cst_context.rs`
- Modify: `crates/apex-lang/src/lib.rs` (add `pub mod cst_context;`)

**Interfaces:**
- Consumes: `cst::{parse, node_at_offset, find_ancestor, node_text}`
- Produces:
  - `cst_context::CompletionContext` enum:
    `DeclaratorName { type_text: String }`, `Member { receiver_text: String }`,
    `TypeOnly`, `Annotation`, `Expression`, `StatementStart`, `Soql`, `Unknown`
  - `cst_context::classify(tree: &Tree, src: &str, prefix_start: usize) -> CompletionContext`

- [ ] **Step 1: Write the failing test**

Create `crates/apex-lang/src/cst_context.rs`:
```rust
//! Caret-position classification on the CST — the IC2 analog of walking PSI
//! ancestors to the nearest registered completion-context node.

use crate::cst::{find_ancestor, node_at_offset, node_text};
use tree_sitter::{Node, Tree};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionContext {
    /// Naming a new variable after its type: offer names, never types.
    DeclaratorName { type_text: String },
    /// After `.`/`?.`: offer members of the receiver's type.
    Member { receiver_text: String },
    /// Only type names (new / extends / implements / generic args / type slot).
    TypeOnly,
    /// After `@`: annotation names.
    Annotation,
    /// Expression position: locals + types + expression keywords.
    Expression,
    /// Statement boundary: statement/decl/modifier keywords + types + locals.
    StatementStart,
    /// Inside an inline `[ … ]` SOQL/SOSL query.
    Soql,
    /// Nothing to offer.
    Unknown,
}

/// Classify the caret at `prefix_start` (the start byte of the identifier under
/// the caret, so we land inside the token being typed).
pub fn classify(tree: &Tree, src: &str, prefix_start: usize) -> CompletionContext {
    let node = node_at_offset(tree, prefix_start);

    // Member access: caret is the `field` of a field_access, or just after a `.`.
    if let Some(fa) = find_ancestor(node, &["field_access"]) {
        if let Some(obj) = fa.child_by_field_name("object") {
            // Only when the caret is at/after the object (i.e. the field slot).
            if prefix_start >= obj.end_byte() {
                return CompletionContext::Member {
                    receiver_text: node_text(obj, src).to_string(),
                };
            }
        }
    }

    // Inline SOQL/SOSL.
    if find_ancestor(node, &["query_expression"]).is_some() {
        return CompletionContext::Soql;
    }

    // Annotation (after `@`).
    if find_ancestor(node, &["annotation", "marker_annotation"]).is_some() {
        return CompletionContext::Annotation;
    }

    // Variable-declaration name vs type slot.
    if let Some(decl) = find_ancestor(node, &["local_variable_declaration", "formal_parameter"]) {
        if let Some(ty) = decl.child_by_field_name("type") {
            if prefix_start >= ty.end_byte() {
                return CompletionContext::DeclaratorName {
                    type_text: node_text(ty, src).to_string(),
                };
            }
            // caret inside the type itself
            return CompletionContext::TypeOnly;
        }
    }

    // Type-only positions.
    if find_ancestor(node, &["superclass", "interfaces", "type_arguments", "type_parameter"]).is_some()
    {
        return CompletionContext::TypeOnly;
    }
    if let Some(oce) = find_ancestor(node, &["object_creation_expression"]) {
        if let Some(ty) = oce.child_by_field_name("type") {
            if prefix_start <= ty.end_byte() {
                return CompletionContext::TypeOnly;
            }
        }
    }

    // Expression vs statement-start.
    if in_expression(node) {
        return CompletionContext::Expression;
    }
    if find_ancestor(node, &["block", "parser_output"]).is_some() {
        return CompletionContext::StatementStart;
    }

    CompletionContext::Unknown
}

fn in_expression(node: Node) -> bool {
    find_ancestor(
        node,
        &[
            "assignment_expression",
            "binary_expression",
            "ternary_expression",
            "instanceof_expression",
            "unary_expression",
            "argument_list",
            "parenthesized_expression",
            "return_statement",
            "expression_statement",
        ],
    )
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cst::parse;

    fn ctx(src: &str) -> CompletionContext {
        // prefix_start = end of src (caret at EOF, prefix already typed there)
        classify(&parse(src), src, src.len())
    }

    #[test]
    fn declarator_name_position() {
        assert_eq!(
            ctx("List<Account> accou"),
            CompletionContext::DeclaratorName { type_text: "List<Account>".into() }
        );
    }

    #[test]
    fn type_position_after_new() {
        assert_eq!(ctx("Object o = new Acc"), CompletionContext::TypeOnly);
    }

    #[test]
    fn member_after_dot() {
        match ctx("void m(){ acc.nam") {
            CompletionContext::Member { receiver_text } => assert_eq!(receiver_text, "acc"),
            other => panic!("expected Member, got {other:?}"),
        }
    }

    #[test]
    fn soql_inside_brackets() {
        assert_eq!(ctx("List<Account> a = [SELECT Id FR"), CompletionContext::Soql);
    }
}
```

Add `pub mod cst_context;` to `lib.rs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apex-lang cst_context`
Expected: FAIL — module new; or assertions fail on a kind/field name that differs from the grammar.

- [ ] **Step 3: Make it pass**

Implementation is in Step 1. If a test fails, print the parse with `eprintln!("{}", parse(src).root_node().to_sexp())` for that input and adjust the node-kind/field strings to the grammar's actual names (e.g. `object_creation_expression` field is `type`; member access node is `field_access` with `object`/`field`). Keep the enum and signature stable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p apex-lang cst_context`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/apex-lang/src/cst_context.rs crates/apex-lang/src/lib.rs
git commit --no-gpg-sign -m "feat(apex-lang): CST caret-position classification (classify)"
```

---

### Task 5: P1 — rewrite `complete()` on the CST

**Files:**
- Modify: `crates/apex-lang/src/complete.rs`

**Interfaces:**
- Consumes: `cst::parse`, `cst_scope::locals`, `cst_context::{classify, CompletionContext}`, `resolve::resolve_type`, existing `member_candidates`/`all_types`/`push_if_matches`/`default_var_name`/`PRIMITIVES`/`BUILTIN_TYPES`/`ANNOTATIONS`/`sort_and_dedupe`
- Produces: same `complete(input, cursor, ost) -> Vec<Candidate>` (CST-backed)

- [ ] **Step 1: Write the failing tests**

In `crates/apex-lang/src/complete.rs` `mod tests`, add (keep existing tests):
```rust
    #[test]
    fn cst_suppresses_types_in_declarator_name() {
        let ost = ost();
        let src = "List<Account> accou";
        let cands = complete(src, src.len(), &ost);
        assert!(cands.iter().all(|c| c.kind != CandidateKind::Type));
        assert!(cands.iter().any(|c| c.label == "accounts"));
    }

    #[test]
    fn cst_offers_types_after_new() {
        let ost = ost();
        let src = "Object o = new Stri";
        let cands = complete(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "String" && c.kind == CandidateKind::Type));
        assert!(cands.iter().all(|c| c.kind != CandidateKind::LocalVar));
    }

    #[test]
    fn cst_member_access_lists_members() {
        let ost = ost();
        // `acc` is an AccountService; `.sa` should surface its `save` method.
        let src = "void m(){ AccountService acc; acc.sa";
        let cands = complete(src, src.len(), &ost);
        assert!(cands.iter().any(|c| c.label == "save" && c.kind == CandidateKind::Method));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p apex-lang complete`
Expected: FAIL — `complete` still uses the heuristic path; `cst_member_access_lists_members` and the declarator/new behaviors differ.

- [ ] **Step 3: Rewrite `complete()` dispatch**

Replace the body of `pub fn complete(...)` (the `match context_at(...)` block) with the CST dispatch below. Keep all helper fns (`member_candidates`, `all_types`, `push_if_matches`, `default_var_name`, `decapitalize`, `sort_and_dedupe`) and the consts. Update the `use` lines: remove `use crate::parser::{context_at, outline, CursorContext};`, add `use crate::cst; use crate::cst_context::{classify, CompletionContext}; use crate::cst_scope; use crate::resolve::resolve_type;` (drop `resolve_expr_type`/`resolve_receiver_type` imports if now unused).

```rust
pub fn complete(input: &str, cursor: usize, ost: &Ost) -> Vec<Candidate> {
    let cursor = cursor.min(input.len());
    // Identifier prefix left of the caret (same rule as before).
    let bytes = input.as_bytes();
    let mut prefix_start = cursor;
    while prefix_start > 0 && is_ident_byte(bytes[prefix_start - 1]) {
        prefix_start -= 1;
    }
    let prefix = &input[prefix_start..cursor];

    let tree = cst::parse(input);
    let mut candidates = Vec::new();
    match classify(&tree, input, prefix_start) {
        CompletionContext::DeclaratorName { type_text } => {
            push_if_matches(&mut candidates, prefix, &default_var_name(&type_text), CandidateKind::LocalVar);
        }
        CompletionContext::Member { receiver_text } => {
            if let Some(ty) = resolve_member_receiver(&receiver_text, &tree, input, ost) {
                return member_candidates(ty, prefix, receiver_is_type(&receiver_text, ost));
            }
        }
        CompletionContext::TypeOnly => push_types(&mut candidates, prefix, ost),
        CompletionContext::Annotation => {
            for a in ANNOTATIONS {
                push_if_matches(&mut candidates, prefix, a, CandidateKind::Keyword);
            }
        }
        CompletionContext::Expression => {
            push_types(&mut candidates, prefix, ost);
            push_locals(&mut candidates, prefix, &tree, input);
            for kw in EXPR_KEYWORDS {
                push_if_matches(&mut candidates, prefix, kw, CandidateKind::Keyword);
            }
        }
        CompletionContext::StatementStart => {
            push_types(&mut candidates, prefix, ost);
            push_locals(&mut candidates, prefix, &tree, input);
            for kw in KEYWORDS {
                push_if_matches(&mut candidates, prefix, kw, CandidateKind::Keyword);
            }
        }
        CompletionContext::Soql | CompletionContext::Unknown => {}
    }
    sort_and_dedupe(candidates)
}

fn push_types(candidates: &mut Vec<Candidate>, prefix: &str, ost: &Ost) {
    for ty in all_types(ost) {
        push_if_matches(candidates, prefix, &ty.name, CandidateKind::Type);
    }
    for p in PRIMITIVES {
        push_if_matches(candidates, prefix, p, CandidateKind::Type);
    }
    for b in BUILTIN_TYPES {
        push_if_matches(candidates, prefix, b, CandidateKind::Type);
    }
}

fn push_locals(candidates: &mut Vec<Candidate>, prefix: &str, tree: &tree_sitter::Tree, src: &str) {
    for l in cst_scope::locals(tree, src) {
        push_if_matches(candidates, prefix, &l.name, CandidateKind::LocalVar);
    }
}

/// Resolve a member-access receiver to a type: a local's declared type, else
/// the receiver treated as a type name (statics).
fn resolve_member_receiver<'a>(
    receiver: &str,
    tree: &tree_sitter::Tree,
    src: &str,
    ost: &'a Ost,
) -> Option<&'a ApexType> {
    let base = receiver.rsplit('.').next().unwrap_or(receiver);
    if let Some(local) = cst_scope::locals(tree, src)
        .into_iter()
        .find(|l| l.name.eq_ignore_ascii_case(base))
    {
        let ty_name = local.declared_type.split('<').next().unwrap_or(&local.declared_type).trim().to_string();
        return resolve_type(ost, &ty_name);
    }
    resolve_type(ost, base)
}

fn receiver_is_type(receiver: &str, ost: &Ost) -> bool {
    let base = receiver.rsplit('.').next().unwrap_or(receiver);
    resolve_type(ost, base).is_some()
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

const EXPR_KEYWORDS: &[&str] = &["new", "this", "super", "null", "true", "false", "instanceof"];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p apex-lang complete`
Expected: PASS. The earlier heuristic-era tests that asserted the same behaviors (declarator suppression, built-in types, member access) still hold; if any asserted a heuristic-only quirk, update its expectation to the CST behavior (do not weaken the suppression/member assertions).

- [ ] **Step 5: Run the whole crate**

Run: `cargo test -p apex-lang`
Expected: PASS. `needed_type_at`/`soql_region_at` and their tests are untouched (still heuristic).

- [ ] **Step 6: Commit**

```bash
git add crates/apex-lang/src/complete.rs
git commit --no-gpg-sign -m "feat(apex-lang): rewrite completion on the tree-sitter CST (P1)"
```

---

### Task 6: P1 — integration verification

**Files:** none (verification + manual check)

- [ ] **Step 1: Build the app**

Run: `cargo build -p ultraforce-desktop`
Expected: clean.

- [ ] **Step 2: Typecheck the frontend (unchanged, sanity only)**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.json`
Expected: No errors (no TS changed; confirms nothing drifted).

- [ ] **Step 3: Manual smoke test**

Run `npm run tauri dev` from `desktop/`. In the Anonymous Apex panel:
- Type `List<Account> accou` → completion offers `accounts` (a name), NOT `Account*` types.
- Type `new Stri` → offers `String` (type).
- Declare `AccountService svc;` then type `svc.` → offers `save` (member).
- Type `[SELECT Id FR` → SOQL completion (or nothing from the apex provider), not Apex types.

- [ ] **Step 4: Commit (if any doc/notes)**

No code change expected here; if the manual test surfaced a fix, it belongs in Task 5's file with its own test. Otherwise nothing to commit.

---

## Notes for the implementer

- The grammar's exact node-kind / field names are authoritative. When a `classify` or scope test fails on a name, print the tree: `eprintln!("{}", crate::cst::parse(src).root_node().to_sexp());` and match the real names. Common ones confirmed from the grammar: `local_variable_declaration` (field `type`), `_variable_declarator_id` (field `name`), `field_access` (fields `object`, `field`), `object_creation_expression` (field `type`), `superclass`, `interfaces`, `type_arguments`, `query_expression`, `parser_output`, `block`.
- Do not touch `needed_type_at`, `soql_region_at`, `context_at`, `outline` — they remain for the diagnostics path (P2). `complete.rs` simply stops importing `context_at`/`outline`.
- Keep `complete()`'s signature; the Tauri command and Monaco provider must not change.
