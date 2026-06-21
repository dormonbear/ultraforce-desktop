//! Recursive-descent declaration parser (Phase 1, increment 2-3).
//!
//! Parses a compilation unit's structure — type declarations and member
//! signatures — into the typed [`tree`]. Method/property bodies are captured as
//! a [`Span`] (statement parsing is increment 4). Recovers on errors and never
//! panics, so a half-typed buffer still yields a usable tree.

use super::lexer::{lex_code, Tok, Token};
use super::tree::*;

/// Parse Apex source into a [`CompilationUnit`].
pub fn parse(src: &str) -> CompilationUnit {
    let toks = lex_code(src);
    let mut p = Parser {
        src,
        toks,
        pos: 0,
        errors: Vec::new(),
    };
    let mut types = Vec::new();
    while !p.at_end() {
        let before = p.pos;
        if let Some(t) = p.parse_type_decl() {
            types.push(t);
        }
        // Guarantee progress even on unrecognized input.
        if p.pos == before {
            p.pos += 1;
        }
    }
    CompilationUnit {
        types,
        errors: p.errors,
    }
}

const MODIFIERS: &[&str] = &[
    "public",
    "private",
    "protected",
    "global",
    "virtual",
    "abstract",
    "override",
    "static",
    "final",
    "transient",
    "webservice",
];

struct Parser<'a> {
    src: &'a str,
    toks: Vec<Token>,
    pos: usize,
    errors: Vec<ParseError>,
}

impl<'a> Parser<'a> {
    fn at_end(&self) -> bool {
        self.pos >= self.toks.len()
    }

    fn peek(&self) -> Option<Token> {
        self.toks.get(self.pos).copied()
    }

    fn peek_at(&self, off: usize) -> Option<Token> {
        self.toks.get(self.pos + off).copied()
    }

    fn kind(&self) -> Option<Tok> {
        self.peek().map(|t| t.kind)
    }

    fn text(&self, t: Token) -> &'a str {
        t.text(self.src)
    }

    fn bump(&mut self) -> Option<Token> {
        let t = self.peek();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn eat(&mut self, k: Tok) -> bool {
        if self.kind() == Some(k) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn error(&mut self, message: impl Into<String>, span: Span) {
        self.errors.push(ParseError {
            message: message.into(),
            span,
        });
    }

    fn tok_span(&self, t: Token) -> Span {
        Span {
            start: t.start,
            end: t.end,
        }
    }

    /// keyword token whose lowercased text equals `kw`.
    fn at_keyword(&self, kw: &str) -> bool {
        matches!(self.peek(), Some(t) if t.kind == Tok::Keyword && self.text(t).eq_ignore_ascii_case(kw))
    }

    /// Collect leading `@Annotation[(...)]` names.
    fn parse_annotations(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        while self.kind() == Some(Tok::At) {
            self.bump(); // @
            if let Some(t) = self.peek() {
                if t.kind == Tok::Ident || t.kind == Tok::Keyword {
                    out.push(self.text(t).to_string());
                    self.bump();
                }
            }
            // Skip optional `( ... )` annotation arguments.
            if self.kind() == Some(Tok::LParen) {
                self.skip_balanced(Tok::LParen, Tok::RParen);
            }
        }
        out
    }

    /// Collect leading modifiers (`public`, `static`, … and `with/without/inherited sharing`).
    fn parse_modifiers(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            match self.peek() {
                Some(t)
                    if t.kind == Tok::Keyword
                        && MODIFIERS.contains(&self.text(t).to_ascii_lowercase().as_str()) =>
                {
                    out.push(self.text(t).to_ascii_lowercase());
                    self.bump();
                }
                // `with sharing` / `without sharing` / `inherited sharing`.
                Some(t)
                    if t.kind == Tok::Ident
                        && matches!(
                            self.text(t).to_ascii_lowercase().as_str(),
                            "with" | "without" | "inherited"
                        )
                        && self
                            .peek_at(1)
                            .is_some_and(|n| self.text(n).eq_ignore_ascii_case("sharing")) =>
                {
                    let word = self.text(t).to_ascii_lowercase();
                    self.bump();
                    self.bump();
                    out.push(format!("{word} sharing"));
                }
                _ => break,
            }
        }
        out
    }

    /// Parse a type reference (`Ns.Type<...>[]`) as source text + span. The cursor
    /// must be on an `Ident` or the `void` keyword.
    fn parse_type_ref(&mut self) -> Option<(String, Span)> {
        let first = self.peek()?;
        let is_void = first.kind == Tok::Keyword && self.text(first).eq_ignore_ascii_case("void");
        if first.kind != Tok::Ident && !is_void {
            return None;
        }
        let start = first.start;
        let mut end = first.end;
        self.bump();
        while self.kind() == Some(Tok::Dot) && self.peek_at(1).map(|t| t.kind) == Some(Tok::Ident) {
            self.bump();
            end = self.bump().unwrap().end;
        }
        if self.kind() == Some(Tok::Lt) {
            end = self.skip_balanced(Tok::Lt, Tok::Gt);
        }
        while self.kind() == Some(Tok::LBracket) {
            self.bump();
            if self.kind() == Some(Tok::RBracket) {
                end = self.bump().unwrap().end;
            }
        }
        Some((self.src[start..end].to_string(), Span { start, end }))
    }

    /// Skip a balanced `open … close` group; returns the end byte offset.
    /// Assumes the cursor is on `open`.
    fn skip_balanced(&mut self, open: Tok, close: Tok) -> usize {
        let mut depth = 0;
        let mut end = self.peek().map(|t| t.end).unwrap_or(0);
        while let Some(t) = self.peek() {
            end = t.end;
            if t.kind == open {
                depth += 1;
            } else if t.kind == close {
                depth -= 1;
                self.bump();
                if depth == 0 {
                    break;
                }
                continue;
            }
            self.bump();
        }
        end
    }

    fn parse_type_decl(&mut self) -> Option<TypeDecl> {
        let start = self.peek()?.start;
        let annotations = self.parse_annotations();
        let modifiers = self.parse_modifiers();

        let kind = if self.at_keyword("class") {
            TypeKind::Class
        } else if self.at_keyword("interface") {
            TypeKind::Interface
        } else if self.at_keyword("enum") {
            TypeKind::Enum
        } else {
            // Not a type declaration; if we consumed modifiers/annotations,
            // record an error so recovery can move on.
            if !annotations.is_empty() || !modifiers.is_empty() {
                let sp = self.peek().map(|t| self.tok_span(t)).unwrap_or_default();
                self.error("expected class/interface/enum", sp);
            }
            return None;
        };
        self.bump(); // class/interface/enum keyword

        let name = match self.peek() {
            Some(t) if t.kind == Tok::Ident => {
                let n = self.text(t).to_string();
                self.bump();
                n
            }
            _ => {
                let sp = self.peek().map(|t| self.tok_span(t)).unwrap_or_default();
                self.error("expected type name", sp);
                String::new()
            }
        };

        let mut extends = None;
        if self.at_keyword("extends") {
            self.bump();
            extends = self.parse_type_ref().map(|(t, _)| t);
        }
        let mut implements = Vec::new();
        if self.at_keyword("implements") {
            self.bump();
            while let Some((t, _)) = self.parse_type_ref() {
                implements.push(t);
                if !self.eat(Tok::Comma) {
                    break;
                }
            }
        }

        let mut members = Vec::new();
        let mut enum_constants = Vec::new();
        let mut end = self
            .toks
            .get(self.pos.saturating_sub(1))
            .map(|t| t.end)
            .unwrap_or(start);
        if self.eat(Tok::LBrace) {
            if kind == TypeKind::Enum {
                while let Some(t) = self.peek() {
                    if t.kind == Tok::RBrace {
                        break;
                    }
                    if t.kind == Tok::Ident {
                        enum_constants.push(self.text(t).to_string());
                    }
                    self.bump();
                    self.eat(Tok::Comma);
                }
            } else {
                while let Some(t) = self.peek() {
                    if t.kind == Tok::RBrace {
                        break;
                    }
                    let before = self.pos;
                    if let Some(m) = self.parse_member() {
                        members.push(m);
                    }
                    if self.pos == before {
                        self.pos += 1; // ensure progress
                    }
                }
            }
            if let Some(close) = self.peek() {
                if close.kind == Tok::RBrace {
                    end = close.end;
                    self.bump();
                }
            }
        } else {
            let sp = self.peek().map(|t| self.tok_span(t)).unwrap_or_default();
            self.error("expected '{'", sp);
        }

        Some(TypeDecl {
            kind,
            annotations,
            modifiers,
            name,
            extends,
            implements,
            members,
            enum_constants,
            span: Span { start, end },
        })
    }

    fn parse_member(&mut self) -> Option<Member> {
        let start = self.peek()?.start;
        let annotations = self.parse_annotations();
        let modifiers = self.parse_modifiers();

        // Nested type.
        if self.at_keyword("class") || self.at_keyword("interface") || self.at_keyword("enum") {
            // Re-parse from here as a type decl (annotations/modifiers already eaten,
            // so reconstruct by parsing the keyword onward).
            return self.parse_nested_type(annotations, modifiers, start);
        }

        // Constructor: `Name ( … )` with no return type.
        if matches!(self.peek(), Some(t) if t.kind == Tok::Ident)
            && self.peek_at(1).map(|t| t.kind) == Some(Tok::LParen)
        {
            let name_tok = self.peek().unwrap();
            let name = self.text(name_tok).to_string();
            self.bump();
            return Some(self.finish_method(annotations, modifiers, None, name, start));
        }

        // Otherwise: a type ref, then a member name.
        let (ty, _) = self.parse_type_ref()?;
        let name_tok = self.peek()?;
        if name_tok.kind != Tok::Ident {
            // Unrecognized; recover to the next `;` or member boundary.
            self.recover_member();
            return None;
        }
        let name = self.text(name_tok).to_string();
        self.bump();

        match self.kind() {
            Some(Tok::LParen) => {
                Some(self.finish_method(annotations, modifiers, Some(ty), name, start))
            }
            Some(Tok::LBrace) => {
                // Property: skip the `{ get; set; }` body.
                let end = self.skip_balanced(Tok::LBrace, Tok::RBrace);
                Some(Member::Property(PropertyDecl {
                    modifiers,
                    annotations,
                    ty,
                    name,
                    span: Span { start, end },
                }))
            }
            _ => {
                // Field: consume to the terminating `;`.
                let mut end = name_tok.end;
                while let Some(t) = self.peek() {
                    end = t.end;
                    self.bump();
                    if t.kind == Tok::Semi {
                        break;
                    }
                }
                Some(Member::Field(FieldDecl {
                    modifiers,
                    annotations,
                    ty,
                    name,
                    span: Span { start, end },
                }))
            }
        }
    }

    /// Parse a nested type after its annotations/modifiers were already consumed.
    fn parse_nested_type(
        &mut self,
        annotations: Vec<String>,
        modifiers: Vec<String>,
        start: usize,
    ) -> Option<Member> {
        // Reuse parse_type_decl's tail by temporarily rolling our own: easiest is
        // to call parse_type_decl-like logic. We already ate modifiers, so parse
        // the keyword onward here.
        let inner = self.parse_type_decl_tail(annotations, modifiers, start)?;
        Some(Member::Nested(inner))
    }

    /// The part of a type decl from the `class/interface/enum` keyword onward,
    /// given pre-parsed annotations/modifiers.
    fn parse_type_decl_tail(
        &mut self,
        annotations: Vec<String>,
        modifiers: Vec<String>,
        start: usize,
    ) -> Option<TypeDecl> {
        let kind = if self.at_keyword("class") {
            TypeKind::Class
        } else if self.at_keyword("interface") {
            TypeKind::Interface
        } else if self.at_keyword("enum") {
            TypeKind::Enum
        } else {
            return None;
        };
        self.bump();
        let name = match self.peek() {
            Some(t) if t.kind == Tok::Ident => {
                let n = self.text(t).to_string();
                self.bump();
                n
            }
            _ => String::new(),
        };
        let mut extends = None;
        if self.at_keyword("extends") {
            self.bump();
            extends = self.parse_type_ref().map(|(t, _)| t);
        }
        let mut implements = Vec::new();
        if self.at_keyword("implements") {
            self.bump();
            while let Some((t, _)) = self.parse_type_ref() {
                implements.push(t);
                if !self.eat(Tok::Comma) {
                    break;
                }
            }
        }
        let mut members = Vec::new();
        let mut enum_constants = Vec::new();
        let mut end = self
            .toks
            .get(self.pos.saturating_sub(1))
            .map(|t| t.end)
            .unwrap_or(start);
        if self.eat(Tok::LBrace) {
            if kind == TypeKind::Enum {
                while let Some(t) = self.peek() {
                    if t.kind == Tok::RBrace {
                        break;
                    }
                    if t.kind == Tok::Ident {
                        enum_constants.push(self.text(t).to_string());
                    }
                    self.bump();
                    self.eat(Tok::Comma);
                }
            } else {
                while let Some(t) = self.peek() {
                    if t.kind == Tok::RBrace {
                        break;
                    }
                    let before = self.pos;
                    if let Some(m) = self.parse_member() {
                        members.push(m);
                    }
                    if self.pos == before {
                        self.pos += 1;
                    }
                }
            }
            if let Some(close) = self.peek() {
                if close.kind == Tok::RBrace {
                    end = close.end;
                    self.bump();
                }
            }
        }
        Some(TypeDecl {
            kind,
            annotations,
            modifiers,
            name,
            extends,
            implements,
            members,
            enum_constants,
            span: Span { start, end },
        })
    }

    /// Finish a method/constructor at the `(` of its parameter list.
    fn finish_method(
        &mut self,
        annotations: Vec<String>,
        modifiers: Vec<String>,
        return_type: Option<String>,
        name: String,
        start: usize,
    ) -> Member {
        let params = self.parse_params();
        let mut end = self
            .toks
            .get(self.pos.saturating_sub(1))
            .map(|t| t.end)
            .unwrap_or(start);
        let mut body = None;
        match self.kind() {
            Some(Tok::LBrace) => {
                let body_start = self.peek().unwrap().start;
                let body_end = self.skip_balanced(Tok::LBrace, Tok::RBrace);
                body = Some(Span {
                    start: body_start,
                    end: body_end,
                });
                end = body_end;
            }
            Some(Tok::Semi) => {
                end = self.peek().unwrap().end;
                self.bump();
            }
            _ => {}
        }
        Member::Method(MethodDecl {
            modifiers,
            annotations,
            return_type,
            name,
            params,
            body,
            span: Span { start, end },
        })
    }

    /// Parse `( type name, … )` parameters. Cursor is on `(`.
    fn parse_params(&mut self) -> Vec<Param> {
        let mut params = Vec::new();
        if !self.eat(Tok::LParen) {
            return params;
        }
        while let Some(t) = self.peek() {
            if t.kind == Tok::RParen {
                self.bump();
                break;
            }
            if let Some((ty, _)) = self.parse_type_ref() {
                if let Some(n) = self.peek() {
                    if n.kind == Tok::Ident {
                        params.push(Param {
                            ty,
                            name: self.text(n).to_string(),
                        });
                        self.bump();
                    }
                }
            } else {
                self.bump(); // skip unexpected token
            }
            self.eat(Tok::Comma);
        }
        params
    }

    /// On a malformed member, skip to the next `;` or balanced `}`/member start.
    fn recover_member(&mut self) {
        while let Some(t) = self.peek() {
            match t.kind {
                Tok::Semi => {
                    self.bump();
                    return;
                }
                Tok::LBrace => {
                    self.skip_balanced(Tok::LBrace, Tok::RBrace);
                    return;
                }
                Tok::RBrace => return,
                _ => {
                    self.bump();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_class_header_and_members() {
        let src = "public virtual class Foo extends Base implements A, B {\
            private Integer count;\
            public String name { get; set; }\
            public void doIt(Integer n, String s) { count = n; }\
            public Foo() {}\
        }";
        let cu = parse(src);
        assert_eq!(cu.types.len(), 1);
        let t = &cu.types[0];
        assert_eq!(t.kind, TypeKind::Class);
        assert_eq!(t.name, "Foo");
        assert_eq!(t.modifiers, vec!["public", "virtual"]);
        assert_eq!(t.extends.as_deref(), Some("Base"));
        assert_eq!(t.implements, vec!["A", "B"]);
        assert_eq!(t.members.len(), 4);
        assert!(
            matches!(&t.members[0], Member::Field(f) if f.name == "count" && f.ty == "Integer")
        );
        assert!(matches!(&t.members[1], Member::Property(p) if p.name == "name"));
        assert!(
            matches!(&t.members[2], Member::Method(m) if m.name == "doIt" && m.return_type.as_deref() == Some("void") && m.params.len() == 2 && m.body.is_some())
        );
        assert!(
            matches!(&t.members[3], Member::Method(m) if m.name == "Foo" && m.return_type.is_none())
        );
        assert!(cu.errors.is_empty(), "{:?}", cu.errors);
    }

    #[test]
    fn parses_interface_signatures() {
        let cu = parse("public interface Shape { Decimal area(); void scale(Decimal f); }");
        let t = &cu.types[0];
        assert_eq!(t.kind, TypeKind::Interface);
        assert_eq!(t.members.len(), 2);
        assert!(matches!(&t.members[0], Member::Method(m) if m.name == "area" && m.body.is_none()));
        assert!(
            matches!(&t.members[1], Member::Method(m) if m.name == "scale" && m.params.len() == 1)
        );
    }

    #[test]
    fn parses_enum() {
        let cu = parse("public enum Color { RED, GREEN, BLUE }");
        let t = &cu.types[0];
        assert_eq!(t.kind, TypeKind::Enum);
        assert_eq!(t.enum_constants, vec!["RED", "GREEN", "BLUE"]);
    }

    #[test]
    fn parses_generic_and_nested_type() {
        let src = "class Outer { Map<Id, List<Account>> m; class Inner { Integer x; } }";
        let cu = parse(src);
        let t = &cu.types[0];
        assert_eq!(t.members.len(), 2);
        assert!(matches!(&t.members[0], Member::Field(f) if f.ty == "Map<Id, List<Account>>"));
        assert!(
            matches!(&t.members[1], Member::Nested(n) if n.name == "Inner" && n.members.len() == 1)
        );
    }

    #[test]
    fn annotations_are_captured() {
        let cu = parse("@IsTest public class T { @TestVisible private Integer x; }");
        let t = &cu.types[0];
        assert_eq!(t.annotations, vec!["IsTest"]);
        assert!(
            matches!(&t.members[0], Member::Field(f) if f.annotations == vec!["TestVisible".to_string()])
        );
    }

    #[test]
    fn body_span_covers_braces() {
        let src = "class C { void m() { Integer y = 1; } }";
        let cu = parse(src);
        if let Member::Method(m) = &cu.types[0].members[0] {
            let b = m.body.unwrap();
            assert_eq!(&src[b.start..b.end], "{ Integer y = 1; }");
        } else {
            panic!("expected method");
        }
    }

    #[test]
    fn recovers_from_garbage_member() {
        let cu = parse("class C { @#$ ; Integer ok; }");
        let t = &cu.types[0];
        // The valid field is still found after recovery.
        assert!(t
            .members
            .iter()
            .any(|m| matches!(m, Member::Field(f) if f.name == "ok")));
    }

    #[test]
    fn with_sharing_modifier() {
        let cu = parse("public with sharing class S {}");
        assert_eq!(cu.types[0].modifiers, vec!["public", "with sharing"]);
    }

    #[test]
    fn does_not_panic_on_partial_input() {
        // Half-typed buffers must not panic.
        for src in [
            "public class",
            "class C {",
            "class C { void m(",
            "@",
            "}{}{",
        ] {
            let _ = parse(src);
        }
    }
}
