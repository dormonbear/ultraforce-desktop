# apex-lang Phase 2 (MVP): expression-chain member completion — Implementation Plan

> Makes `receiver.method().` and `receiver.prop.` chains complete by walking the chain through the
> OST's method `return_type` / property `prop_type`. Pure `apex-lang` crate change (parser → resolve →
> complete). No desktop/Tauri/React change — the `apex_complete` command already calls `complete()`.
> Completion-only (benign): a missed/extra candidate never breaks user code.

## Goal

Today `context_at` only inspects the single token before the cursor dot, so a chain like
`a.getB().c|` (the token before the `.c` dot is `)`) returns `Unknown` → no completion. Add chain
extraction + chain-type resolution so multi-segment receivers complete against the resolved result type.

## Scope (MVP) / YAGNI

- IN: chains of `Ident` segments, each optionally a call `Ident(...)` (args ignored — balanced parens
  skipped); generics stripped to the base type (`List<Account>` → `List`); method overloads resolved
  by NAME ONLY (first match); property-before-method on non-call segments.
- OUT (later phases): argument-type-aware overload resolution; generic element unwrapping
  (`List<Account>` element → `Account`); free-function/`this`/`super` bases; static chains off results.

## Global Constraints

- Rust 2021, crate `crates/apex-lang`. Pure modules stay pure (no IO/sf). English code/comments.
- TDD per task: write failing test, run `cargo test -p apex-lang`, see fail, implement, see pass, commit.
- `cargo clippy -p apex-lang -- -D warnings` clean; `cargo fmt -p apex-lang --check` clean.
- Do NOT change existing public fn signatures or existing test expectations; single-segment receivers
  (`String.x`, `svc.y`) MUST keep emitting `StaticMember`/`InstanceMember` exactly as today.
- Conventional commits, no author attribution. Never create/switch branches; never `git push`.

## Pre-verified facts

- `parser.rs`: `pub enum CursorContext { TopLevel{prefix}, StaticMember{type_name,prefix},
  InstanceMember{receiver,prefix}, Unknown }`; `context_at(input, cursor)` builds `non_ws: Vec<&Token>`
  (whitespace filtered) of `lex(&input[..prefix_start])` and currently checks only `non_ws.last()==Dot`
  + `non_ws.iter().rev().nth(1)`. Helpers `is_type_shaped`, `is_ident_continue` exist. `lex` →
  `Token { kind, text, start, end }`; `TokenKind::{Ident,Dot,LParen,RParen,...}`.
- `resolve.rs`: `resolve_type(ost,name)->Option<&ApexType>` (org_types then namespaces, case-insensitive);
  `resolve_receiver_type(ost, outline, receiver)` (local decl-type, else type name).
- `symbols.rs`: `ApexType { name, kind, methods: Vec<Method>, properties: Vec<Property>, enum_values }`;
  `Method { name, return_type: String, params, is_static }`; `Property { name, prop_type: String, is_static }`;
  `TypeKind::{Class,Interface,Enum}`; all derive Clone+Default; fields pub.
- `complete.rs`: `complete(input,cursor,ost)` matches `CursorContext`; `member_candidates(ty,prefix,want_static)`
  emits methods+properties filtered by `is_static==want_static` and prefix.

---

### Task 1: parser — `Segment` + `ChainMember` context + chain extraction (RED first)

**Files:** modify `crates/apex-lang/src/parser.rs`.

- [ ] **Step 1: failing tests** — add to parser.rs tests:
  ```rust
  #[test]
  fn chain_member_context_extracts_segments() {
      // svc : base, getSelf() : call segment; completing ".sa"
      let input = "AccountService svc; svc.getSelf().sa";
      match context_at(input, input.len()) {
          CursorContext::ChainMember { chain, prefix } => {
              assert_eq!(prefix, "sa");
              assert_eq!(chain.len(), 2);
              assert_eq!(chain[0], Segment { name: "svc".into(), is_call: false });
              assert_eq!(chain[1], Segment { name: "getSelf".into(), is_call: true });
          }
          other => panic!("expected ChainMember, got {other:?}"),
      }
  }

  #[test]
  fn single_segment_still_instance_or_static() {
      // unchanged behavior for one-segment receivers
      assert!(matches!(
          context_at("String.va", "String.va".len()),
          CursorContext::StaticMember { .. }
      ));
      assert!(matches!(
          context_at("Account a; a.na", "Account a; a.na".len()),
          CursorContext::InstanceMember { .. }
      ));
  }
  ```

- [ ] **Step 2: run → fail** (`cargo test -p apex-lang parser`). `Segment`/`ChainMember` don't exist.

- [ ] **Step 3: implement** in parser.rs:
  - Add the type (above `CursorContext`):
    ```rust
    /// One link in a receiver chain: `name` plus whether it is a call `name(...)`.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Segment {
        pub name: String,
        pub is_call: bool,
    }
    ```
  - Add a variant to `CursorContext`:
    ```rust
        ChainMember { chain: Vec<Segment>, prefix: String },
    ```
  - In `context_at`, AFTER computing `prefix` and `non_ws`, replace the `if non_ws.last()==Dot {…}`
    block so that when the last non_ws token is `Dot`, it extracts the full chain:
    ```rust
    if non_ws.last().is_some_and(|t| t.kind == TokenKind::Dot) {
        let chain = extract_chain(&non_ws); // segments left→right (excludes the trailing dot)
        return match chain.as_slice() {
            // one plain identifier → preserve today's Static/Instance behavior
            [only] if !only.is_call => {
                if is_type_shaped(&only.name) {
                    CursorContext::StaticMember { type_name: only.name.clone(), prefix: prefix.to_string() }
                } else {
                    CursorContext::InstanceMember { receiver: only.name.clone(), prefix: prefix.to_string() }
                }
            }
            [] => CursorContext::Unknown,
            _ => CursorContext::ChainMember { chain, prefix: prefix.to_string() },
        };
    }
    ```
  - Add `extract_chain` (walks `non_ws` right→left from the trailing Dot; returns segments left→right):
    ```rust
    /// Walk the receiver chain ending at the trailing `.` (non_ws.last()). Returns segments
    /// left→right. Skips balanced call parens; stops at the first token that is not part of a
    /// `Ident (call)? (. Ident (call)?)*` run.
    fn extract_chain(non_ws: &[&Token]) -> Vec<Segment> {
        let mut segs: Vec<Segment> = Vec::new();
        // index of the token just before the trailing dot
        let mut i = match non_ws.len().checked_sub(2) {
            Some(i) => i as isize,
            None => return segs,
        };
        loop {
            let mut is_call = false;
            // optional call: skip a balanced ) ... (
            if i >= 0 && non_ws[i as usize].kind == TokenKind::RParen {
                let mut depth = 0i32;
                while i >= 0 {
                    match non_ws[i as usize].kind {
                        TokenKind::RParen => depth += 1,
                        TokenKind::LParen => {
                            depth -= 1;
                            if depth == 0 { i -= 1; break; }
                        }
                        _ => {}
                    }
                    i -= 1;
                }
                if depth != 0 { return Vec::new(); } // unbalanced → give up
                is_call = true;
            }
            // the name
            if i >= 0 && non_ws[i as usize].kind == TokenKind::Ident {
                segs.push(Segment { name: non_ws[i as usize].text.clone(), is_call });
                i -= 1;
            } else {
                // a call with no preceding identifier, or no identifier at all → stop
                break;
            }
            // continue only if another dot precedes this segment
            if i >= 0 && non_ws[i as usize].kind == TokenKind::Dot {
                i -= 1;
                continue;
            }
            break;
        }
        segs.reverse();
        segs
    }
    ```

- [ ] **Step 4: run → green**; clippy + fmt clean.
- [ ] **Step 5: commit** `feat(apex-lang): parse receiver chains for member completion`

---

### Task 2: resolve — `resolve_expr_type` + generics strip (RED first)

**Files:** modify `crates/apex-lang/src/resolve.rs`.

- [ ] **Step 1: failing test** — add to resolve.rs tests (extend the in-code `ost()` with a
  self-returning instance method so a chain can be walked):
  ```rust
  #[test]
  fn resolve_expr_type_walks_call_chain() {
      use crate::parser::Segment;
      // Account has instance method `self_` returning "Account"
      let ost = Ost {
          namespaces: vec![],
          org_types: vec![ApexType {
              name: "Account".into(), kind: TypeKind::Class,
              methods: vec![Method { name: "self_".into(), return_type: "Account".into(),
                                     params: vec![], is_static: false }],
              properties: vec![], enum_values: vec![],
          }],
      };
      let outline = ApexOutline { locals: vec![LocalVar { name: "a".into(), declared_type: "Account".into() }] };
      let chain = vec![
          Segment { name: "a".into(), is_call: false },
          Segment { name: "self_".into(), is_call: true },
      ];
      assert_eq!(resolve_expr_type(&ost, &outline, &chain).unwrap().name, "Account");

      // unknown member → None
      let bad = vec![Segment { name: "a".into(), is_call: false },
                     Segment { name: "nope".into(), is_call: true }];
      assert!(resolve_expr_type(&ost, &outline, &bad).is_none());
  }
  ```

- [ ] **Step 2: run → fail.**

- [ ] **Step 3: implement** in resolve.rs:
  ```rust
  use crate::parser::Segment;

  /// `List<Account>` → `List`; `Account` → `Account`. Trims whitespace.
  fn base_type_name(t: &str) -> &str {
      t.split('<').next().unwrap_or(t).trim()
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
      let mut cur = resolve_receiver_type(ost, outline, &base.name)?;
      for seg in rest {
          let next_name: &str = if seg.is_call {
              let m = cur.methods.iter().find(|m| m.name.eq_ignore_ascii_case(&seg.name))?;
              base_type_name(&m.return_type)
          } else if let Some(p) = cur.properties.iter().find(|p| p.name.eq_ignore_ascii_case(&seg.name)) {
              base_type_name(&p.prop_type)
          } else {
              // getter-as-method fallback
              let m = cur.methods.iter().find(|m| m.name.eq_ignore_ascii_case(&seg.name))?;
              base_type_name(&m.return_type)
          };
          if next_name.eq_ignore_ascii_case("void") {
              return None;
          }
          cur = resolve_type(ost, next_name)?;
      }
      Some(cur)
  }
  ```

- [ ] **Step 4: run → green**; clippy + fmt clean.
- [ ] **Step 5: commit** `feat(apex-lang): resolve receiver-chain result type`

---

### Task 3: complete — wire `ChainMember` (RED first)

**Files:** modify `crates/apex-lang/src/complete.rs`.

- [ ] **Step 1: failing test** — add to complete.rs tests. Extend the in-code `ost()` org type
  `AccountService` with an instance method `self_` returning "AccountService" (so a chain can land
  back on a type that has the existing `save` member), then:
  ```rust
  #[test]
  fn completes_member_access_through_a_call_chain() {
      let ost = ost(); // add `self_` (returns "AccountService", instance) to AccountService.methods
      let input = "AccountService svc; svc.self_().sa";
      let got = complete(input, input.len(), &ost);
      assert!(got.iter().any(|c| c.label == "save" && c.kind == CandidateKind::Method), "{got:?}");
  }
  ```
  (Add the `self_` method to the test `ost()` helper; keep all existing assertions passing.)

- [ ] **Step 2: run → fail** (ChainMember arm missing → today returns `Unknown` → empty).

- [ ] **Step 3: implement** — add the match arm in `complete()` and the import:
  ```rust
  use crate::resolve::{resolve_expr_type, resolve_receiver_type, resolve_type};
  // ...
      CursorContext::ChainMember { chain, prefix } => {
          resolve_expr_type(ost, &outline, &chain)
              .map(|ty| member_candidates(ty, &prefix, false))
              .unwrap_or_default()
      }
  ```

- [ ] **Step 4: run → green**; then full gates:
  `cargo test -p apex-lang && cargo clippy -p apex-lang -- -D warnings && cargo fmt -p apex-lang --check`
- [ ] **Step 5: commit** `feat(apex-lang): complete members through expression chains`

---

## Self-Review

- **Spec coverage:** chain parse (T1), chain-type resolution with generics-strip + name-only overloads (T2),
  completion wiring (T3). Single-segment receivers unchanged (asserted in T1). Completion-only — no
  desktop change; the existing `apex_complete` command picks this up for free.
- **Benign by construction:** resolution returns `None` on any miss → empty candidates; never errors.
- **Pure:** parser/resolve/complete stay IO-free; tests use in-code OSTs.
- **Known limits (documented):** args ignored in overload pick (first by name); generic element types not
  unwrapped (`List<Account>` resolves to `List`, so `myList.get(0).` won't reach `Account` yet); no
  `this`/`super`/free-call bases. These are the explicit next Phase-2 increments.
