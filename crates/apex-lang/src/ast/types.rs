//! Structured Apex type model (Phase 2). Turns the AST's text type references
//! into a resolved [`Type`]. Pure — name→symbol resolution is Phase 3-4.

/// An Apex primitive type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Primitive {
    Blob,
    Boolean,
    Date,
    Datetime,
    Decimal,
    Double,
    Id,
    Integer,
    Long,
    Object,
    String,
    Time,
}

impl Primitive {
    /// Match an Apex primitive by name (case-insensitive).
    fn from_name(name: &str) -> Option<Primitive> {
        Some(match name.to_ascii_lowercase().as_str() {
            "blob" => Primitive::Blob,
            "boolean" => Primitive::Boolean,
            "date" => Primitive::Date,
            "datetime" => Primitive::Datetime,
            "decimal" => Primitive::Decimal,
            "double" => Primitive::Double,
            "id" => Primitive::Id,
            "integer" => Primitive::Integer,
            "long" => Primitive::Long,
            "object" => Primitive::Object,
            "string" => Primitive::String,
            "time" => Primitive::Time,
            _ => return None,
        })
    }

    /// The canonical Apex spelling.
    pub fn name(&self) -> &'static str {
        match self {
            Primitive::Blob => "Blob",
            Primitive::Boolean => "Boolean",
            Primitive::Date => "Date",
            Primitive::Datetime => "Datetime",
            Primitive::Decimal => "Decimal",
            Primitive::Double => "Double",
            Primitive::Id => "Id",
            Primitive::Integer => "Integer",
            Primitive::Long => "Long",
            Primitive::Object => "Object",
            Primitive::String => "String",
            Primitive::Time => "Time",
        }
    }
}

/// A resolved Apex type reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Type {
    Void,
    Primitive(Primitive),
    List(Box<Type>),
    Set(Box<Type>),
    Map(Box<Type>, Box<Type>),
    /// A class / interface / enum / sObject — resolved against the OST later.
    Named(String),
    /// Unparseable, empty, or a generic type parameter.
    Unknown,
}

impl Type {
    /// Parse a type-reference string (`Map<Id, List<Account>>`, `Account[]`, `void`,
    /// `Integer`) into a [`Type`].
    pub fn parse(text: &str) -> Type {
        let t = text.trim();
        if t.is_empty() {
            return Type::Unknown;
        }
        // Array suffix: `T[]` is `List<T>`.
        if let Some(inner) = t.strip_suffix("[]") {
            return Type::List(Box::new(Type::parse(inner)));
        }
        if t.eq_ignore_ascii_case("void") {
            return Type::Void;
        }
        // Generic head: `Head<args>`.
        if let Some((head, args)) = generic_parts(t) {
            let parts = split_generics(args);
            return match head.to_ascii_lowercase().as_str() {
                "list" if parts.len() == 1 => Type::List(Box::new(Type::parse(parts[0]))),
                "set" if parts.len() == 1 => Type::Set(Box::new(Type::parse(parts[0]))),
                "map" if parts.len() == 2 => Type::Map(
                    Box::new(Type::parse(parts[0])),
                    Box::new(Type::parse(parts[1])),
                ),
                // Other generic (e.g. `Iterable<X>`, a custom generic): keep the head name.
                _ => Type::Named(head.to_string()),
            };
        }
        if let Some(p) = Primitive::from_name(t) {
            return Type::Primitive(p);
        }
        Type::Named(t.to_string())
    }

    /// The element type produced when iterating: `E` of a List/Set, the value of a
    /// Map. `None` for non-collections.
    pub fn element_type(&self) -> Option<&Type> {
        match self {
            Type::List(e) | Type::Set(e) => Some(e),
            Type::Map(_, v) => Some(v),
            _ => None,
        }
    }

    /// True for a List/Set/Map.
    pub fn is_collection(&self) -> bool {
        matches!(self, Type::List(_) | Type::Set(_) | Type::Map(_, _))
    }

    /// Canonical text for this type (round-trips with [`Type::parse`]).
    pub fn display(&self) -> String {
        match self {
            Type::Void => "void".to_string(),
            Type::Primitive(p) => p.name().to_string(),
            Type::List(e) => format!("List<{}>", e.display()),
            Type::Set(e) => format!("Set<{}>", e.display()),
            Type::Map(k, v) => format!("Map<{}, {}>", k.display(), v.display()),
            Type::Named(n) => n.clone(),
            Type::Unknown => "Object".to_string(),
        }
    }
}

/// Split a `Head<args>` into `(head, args)` when the string is a single generic
/// application whose closing `>` is the final char. `None` otherwise.
fn generic_parts(t: &str) -> Option<(&str, &str)> {
    let open = t.find('<')?;
    if !t.ends_with('>') {
        return None;
    }
    let head = t[..open].trim();
    if head.is_empty() {
        return None;
    }
    let args = &t[open + 1..t.len() - 1];
    Some((head, args))
}

/// Split top-level comma-separated generic arguments, respecting `<…>` nesting.
fn split_generics(args: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (i, c) in args.char_indices() {
        match c {
            '<' => depth += 1,
            '>' => depth -= 1,
            ',' if depth == 0 => {
                out.push(args[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    let last = args[start..].trim();
    if !last.is_empty() {
        out.push(last);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primitives_case_insensitively() {
        assert_eq!(Type::parse("Integer"), Type::Primitive(Primitive::Integer));
        assert_eq!(Type::parse("STRING"), Type::Primitive(Primitive::String));
        assert_eq!(Type::parse("decimal"), Type::Primitive(Primitive::Decimal));
    }

    #[test]
    fn parses_void_and_named() {
        assert_eq!(Type::parse("void"), Type::Void);
        assert_eq!(Type::parse("Account"), Type::Named("Account".to_string()));
        assert_eq!(
            Type::parse("my_pkg__Obj__c"),
            Type::Named("my_pkg__Obj__c".to_string())
        );
        assert_eq!(Type::parse(""), Type::Unknown);
    }

    #[test]
    fn parses_collections() {
        assert_eq!(
            Type::parse("List<Account>"),
            Type::List(Box::new(Type::Named("Account".to_string())))
        );
        assert_eq!(
            Type::parse("Set<Id>"),
            Type::Set(Box::new(Type::Primitive(Primitive::Id)))
        );
        assert_eq!(
            Type::parse("Map<Id, String>"),
            Type::Map(
                Box::new(Type::Primitive(Primitive::Id)),
                Box::new(Type::Primitive(Primitive::String))
            )
        );
    }

    #[test]
    fn parses_nested_generics() {
        let t = Type::parse("Map<Id, List<Account>>");
        assert_eq!(
            t,
            Type::Map(
                Box::new(Type::Primitive(Primitive::Id)),
                Box::new(Type::List(Box::new(Type::Named("Account".to_string()))))
            )
        );
    }

    #[test]
    fn array_suffix_is_a_list() {
        assert_eq!(
            Type::parse("Account[]"),
            Type::List(Box::new(Type::Named("Account".to_string())))
        );
        assert_eq!(
            Type::parse("Integer[]"),
            Type::List(Box::new(Type::Primitive(Primitive::Integer)))
        );
    }

    #[test]
    fn unknown_generic_keeps_head() {
        assert_eq!(
            Type::parse("Iterable<String>"),
            Type::Named("Iterable".to_string())
        );
    }

    #[test]
    fn element_type_of_collections() {
        assert_eq!(
            Type::parse("List<Account>").element_type(),
            Some(&Type::Named("Account".to_string()))
        );
        assert_eq!(
            Type::parse("Map<Id, Account>").element_type(),
            Some(&Type::Named("Account".to_string()))
        );
        assert_eq!(Type::parse("Integer").element_type(), None);
    }

    #[test]
    fn display_round_trips() {
        for s in [
            "Integer",
            "void",
            "Account",
            "List<Account>",
            "Map<Id, List<Account>>",
        ] {
            let parsed = Type::parse(s);
            assert_eq!(Type::parse(&parsed.display()), parsed, "round-trip {s}");
        }
    }

    #[test]
    fn end_to_end_resolves_member_types_from_the_ast() {
        // Phase 1 AST → Phase 2 type model: parse a class, resolve each member's
        // declared type text into a structured Type.
        use crate::ast::parser::parse;
        use crate::ast::tree::Member;

        let src = "public class Repo {\
            private Map<Id, List<Account>> byOwner;\
            public Integer count;\
            public List<Account> findAll() { return null; }\
            public void log(String msg) {}\
        }";
        let cu = parse(src);
        let members = &cu.types[0].members;

        let field_ty = |name: &str| -> Type {
            members
                .iter()
                .find_map(|m| match m {
                    Member::Field(f) if f.name == name => Some(Type::parse(&f.ty)),
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(
            field_ty("byOwner"),
            Type::Map(
                Box::new(Type::Primitive(Primitive::Id)),
                Box::new(Type::List(Box::new(Type::Named("Account".to_string())))),
            )
        );
        assert_eq!(field_ty("count"), Type::Primitive(Primitive::Integer));

        let ret_ty = |name: &str| -> Type {
            members
                .iter()
                .find_map(|m| match m {
                    Member::Method(m) if m.name == name => {
                        Some(Type::parse(m.return_type.as_deref().unwrap_or("")))
                    }
                    _ => None,
                })
                .unwrap()
        };
        assert_eq!(
            ret_ty("findAll"),
            Type::List(Box::new(Type::Named("Account".to_string())))
        );
        assert_eq!(ret_ty("log"), Type::Void);
    }
}
