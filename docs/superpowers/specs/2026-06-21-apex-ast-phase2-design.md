# Apex AST — Phase 2 (type model) — Design

> Date: 2026-06-21 · Status: COMPLETE · Crate: apex-lang
> Phase 2 of `2026-06-21-lsp-apex-completion-design.md`, builds on the Phase-1 AST.

## Goal

A structured type model that turns the AST's text type references (`Map<Id, List<Account>>`,
`Account[]`, `void`, `Integer`) into a resolved [`Type`], distinguishing Apex primitives,
collections (with element types), `void`, and named types (classes / interfaces / enums /
sObjects). Named types resolve against the existing org symbol table (`symbols::Ost`) in later
phases; Phase 2 delivers the model + the type-reference parser.

## Design (`ast/types.rs`)

```rust
pub enum Primitive { Blob, Boolean, Date, Datetime, Decimal, Double, Id, Integer, Long, Object,
                     String, Time }
pub enum Type {
    Void,
    Primitive(Primitive),
    List(Box<Type>),
    Set(Box<Type>),
    Map(Box<Type>, Box<Type>),
    Named(String),   // resolved against the OST in Phase 3-4
    Unknown,         // unparseable / generic type parameter
}
```

- `Type::parse(text) -> Type`: trims, handles `T[]` → `List<T>`, recognizes `void`,
  `List<E>`/`Set<E>`/`Map<K,V>` (case-insensitive, recursive generic args), Apex primitives by
  name (case-insensitive), else `Named(base)`. Generic-arg splitting respects `<…>` nesting.
- Helpers: `element_type()` (the `E` of a List/Set, the value of a Map — for `for-each`
  inference later), `is_collection()`, `display()` (round-trips to canonical text).

Pure, no OST dependency — name → concrete type resolution stays in Phase 3-4.

## Testing

- `ast/types.rs`: primitives case-insensitive; `List<Account>`, `Set<Id>`,
  `Map<Id, List<Account>>` (nested), `Account[]` → `List<Account>`, `void`, named, unknown;
  `element_type` for collections; `display` round-trip.
- Gates: `cargo test --workspace`, clippy `-D warnings`, `cargo fmt --check`; desktop e2e green
  (AST path is internal — confirms no regression).

## Out of scope (Phase 2)

Name → `ApexType` resolution against the OST, member lookup, the System-namespace built-in
method tables, inference — all Phase 3-5.
