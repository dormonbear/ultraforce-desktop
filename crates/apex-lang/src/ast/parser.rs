//! Recursive-descent Apex parser (Phase 1).
//!
//! Parses a compilation unit into the typed [`tree`]: type declarations, member
//! signatures, and full method bodies (statements + expressions with operator
//! precedence). Recovers on errors and never panics, so a half-typed editor
//! buffer still yields a usable tree.

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

/// Parse a standalone expression (for completion's receiver-chain analysis).
/// Returns `None` if `src` doesn't begin with an expression.
pub fn parse_expression(src: &str) -> Option<Expr> {
    let toks = lex_code(src);
    let mut p = Parser {
        src,
        toks,
        pos: 0,
        errors: Vec::new(),
    };
    p.parse_expr()
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
                let block = self.parse_block();
                end = block.span.end;
                body = Some(block);
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

    // ---- Statements (increment 4) ----

    fn prev_end(&self) -> usize {
        self.toks
            .get(self.pos.saturating_sub(1))
            .map(|t| t.end)
            .unwrap_or(0)
    }

    /// Consume a trailing `;` if present; return the end byte offset.
    fn eat_semi(&mut self) -> usize {
        if let Some(t) = self.peek() {
            if t.kind == Tok::Semi {
                self.bump();
                return t.end;
            }
        }
        self.prev_end()
    }

    /// Parse a `{ … }` block. Cursor on `{`.
    fn parse_block(&mut self) -> Block {
        let start = self.peek().map(|t| t.start).unwrap_or(0);
        let mut stmts = Vec::new();
        let mut end = start;
        if self.eat(Tok::LBrace) {
            while let Some(t) = self.peek() {
                if t.kind == Tok::RBrace {
                    break;
                }
                let before = self.pos;
                if let Some(s) = self.parse_stmt() {
                    stmts.push(s);
                }
                if self.pos == before {
                    self.pos += 1; // ensure progress
                }
            }
            if let Some(close) = self.peek() {
                if close.kind == Tok::RBrace {
                    end = close.end;
                    self.bump();
                }
            }
        }
        Block {
            stmts,
            span: Span { start, end },
        }
    }

    fn parse_stmt_or_empty(&mut self) -> Stmt {
        let start = self.peek().map(|t| t.start).unwrap_or(self.prev_end());
        self.parse_stmt()
            .unwrap_or(Stmt::Empty(Span { start, end: start }))
    }

    fn parse_stmt(&mut self) -> Option<Stmt> {
        let t = self.peek()?;
        let start = t.start;

        if t.kind == Tok::Keyword {
            match self.text(t).to_ascii_lowercase().as_str() {
                "if" => return self.parse_if(),
                "for" => return self.parse_for(),
                "while" => return self.parse_while(),
                "do" => return self.parse_do_while(),
                "try" => return self.parse_try(),
                "return" => {
                    self.bump();
                    let e = if self.kind() != Some(Tok::Semi) {
                        self.parse_expr()
                    } else {
                        None
                    };
                    let end = self.eat_semi();
                    return Some(Stmt::Return(e, Span { start, end }));
                }
                "throw" => {
                    self.bump();
                    let e = self
                        .parse_expr()
                        .unwrap_or(Expr::Error(Span { start, end: start }));
                    let end = self.eat_semi();
                    return Some(Stmt::Throw(e, Span { start, end }));
                }
                "break" => {
                    self.bump();
                    let end = self.eat_semi();
                    return Some(Stmt::Break(Span { start, end }));
                }
                "continue" => {
                    self.bump();
                    let end = self.eat_semi();
                    return Some(Stmt::Continue(Span { start, end }));
                }
                _ => {}
            }
        }

        if t.kind == Tok::LBrace {
            return Some(Stmt::Block(self.parse_block()));
        }
        if t.kind == Tok::Semi {
            let end = self.bump().unwrap().end;
            return Some(Stmt::Empty(Span { start, end }));
        }

        // DML statement: `insert expr;` etc. (only when not a call/member/assign).
        if t.kind == Tok::Ident {
            let w = self.text(t).to_ascii_lowercase();
            if matches!(
                w.as_str(),
                "insert" | "update" | "delete" | "upsert" | "undelete" | "merge"
            ) {
                let next = self.peek_at(1).map(|n| n.kind);
                if !matches!(
                    next,
                    Some(Tok::LParen) | Some(Tok::Dot) | Some(Tok::Assign) | Some(Tok::Semi)
                ) {
                    self.bump(); // dml op
                    let e = self
                        .parse_expr()
                        .unwrap_or(Expr::Error(Span { start, end: start }));
                    let end = self.eat_semi();
                    return Some(Stmt::Dml {
                        op: w,
                        expr: e,
                        span: Span { start, end },
                    });
                }
            }
        }

        // Local variable declaration vs. expression statement.
        if let Some(stmt) = self.try_parse_local_var(start) {
            return Some(stmt);
        }
        let e = self.parse_expr()?;
        self.eat_semi();
        Some(Stmt::Expr(e))
    }

    /// `Type a = e, b;` — backtracks to `None` (cursor restored) if the lookahead
    /// isn't a local var declaration.
    fn try_parse_local_var(&mut self, start: usize) -> Option<Stmt> {
        let save = self.pos;
        let Some((ty, _)) = self.parse_type_ref() else {
            self.pos = save;
            return None;
        };
        let is_name = matches!(self.peek(), Some(t) if t.kind == Tok::Ident);
        let after = self.peek_at(1).map(|t| t.kind);
        if !is_name
            || !matches!(
                after,
                Some(Tok::Assign) | Some(Tok::Comma) | Some(Tok::Semi)
            )
        {
            self.pos = save;
            return None;
        }
        let mut decls = Vec::new();
        loop {
            let name = match self.peek() {
                Some(t) if t.kind == Tok::Ident => {
                    let n = self.text(t).to_string();
                    self.bump();
                    n
                }
                _ => break,
            };
            let init = if self.eat(Tok::Assign) {
                self.parse_expr()
            } else {
                None
            };
            decls.push((name, init));
            if !self.eat(Tok::Comma) {
                break;
            }
        }
        let end = self.eat_semi();
        Some(Stmt::LocalVar {
            ty,
            decls,
            span: Span { start, end },
        })
    }

    /// `( expr )` condition; cursor on `(`.
    fn parse_paren_cond(&mut self) -> Expr {
        let start = self.peek().map(|t| t.start).unwrap_or(self.prev_end());
        self.eat(Tok::LParen);
        let e = self
            .parse_expr()
            .unwrap_or(Expr::Error(Span { start, end: start }));
        self.eat(Tok::RParen);
        e
    }

    fn parse_if(&mut self) -> Option<Stmt> {
        let start = self.bump()?.start; // if
        let cond = self.parse_paren_cond();
        let then = Box::new(self.parse_stmt_or_empty());
        let els = if self.at_keyword("else") {
            self.bump();
            Some(Box::new(self.parse_stmt_or_empty()))
        } else {
            None
        };
        let end = self.prev_end();
        Some(Stmt::If {
            cond,
            then,
            els,
            span: Span { start, end },
        })
    }

    fn parse_while(&mut self) -> Option<Stmt> {
        let start = self.bump()?.start; // while
        let cond = self.parse_paren_cond();
        let body = Box::new(self.parse_stmt_or_empty());
        let end = self.prev_end();
        Some(Stmt::While {
            cond,
            body,
            span: Span { start, end },
        })
    }

    fn parse_do_while(&mut self) -> Option<Stmt> {
        let start = self.bump()?.start; // do
        let body = Box::new(self.parse_stmt_or_empty());
        let mut cond = Expr::Error(Span { start, end: start });
        if self.at_keyword("while") {
            self.bump();
            cond = self.parse_paren_cond();
        }
        let end = self.eat_semi();
        Some(Stmt::DoWhile {
            body,
            cond,
            span: Span { start, end },
        })
    }

    fn parse_for(&mut self) -> Option<Stmt> {
        let start = self.bump()?.start; // for
        self.eat(Tok::LParen);

        // For-each? `Type name : iterable`.
        let save = self.pos;
        if let Some((ty, _)) = self.parse_type_ref() {
            if let Some(nt) = self.peek() {
                if nt.kind == Tok::Ident && self.peek_at(1).map(|t| t.kind) == Some(Tok::Colon) {
                    let name = self.text(nt).to_string();
                    self.bump(); // name
                    self.bump(); // :
                    let iter = self
                        .parse_expr()
                        .unwrap_or(Expr::Error(Span { start, end: start }));
                    self.eat(Tok::RParen);
                    let body = Box::new(self.parse_stmt_or_empty());
                    let end = self.prev_end();
                    return Some(Stmt::ForEach {
                        ty,
                        name,
                        iter,
                        body,
                        span: Span { start, end },
                    });
                }
            }
        }
        self.pos = save; // not for-each → C-style

        let init = if self.kind() == Some(Tok::Semi) {
            self.bump();
            None
        } else if let Some(lv) = self.try_parse_local_var(self.peek().map(|t| t.start).unwrap_or(0))
        {
            Some(Box::new(lv))
        } else {
            let e = self.parse_expr();
            self.eat_semi();
            e.map(|e| Box::new(Stmt::Expr(e)))
        };
        let cond = if self.kind() != Some(Tok::Semi) {
            self.parse_expr()
        } else {
            None
        };
        self.eat(Tok::Semi);
        let update = if self.kind() != Some(Tok::RParen) {
            self.parse_expr()
        } else {
            None
        };
        self.eat(Tok::RParen);
        let body = Box::new(self.parse_stmt_or_empty());
        let end = self.prev_end();
        Some(Stmt::For {
            init,
            cond,
            update,
            body,
            span: Span { start, end },
        })
    }

    fn parse_try(&mut self) -> Option<Stmt> {
        let start = self.bump()?.start; // try
        let block = self.parse_block();
        let mut catches = Vec::new();
        while self.at_keyword("catch") {
            self.bump();
            self.eat(Tok::LParen);
            let ty = self.parse_type_ref().map(|(t, _)| t).unwrap_or_default();
            let name = match self.peek() {
                Some(t) if t.kind == Tok::Ident => {
                    let n = self.text(t).to_string();
                    self.bump();
                    n
                }
                _ => String::new(),
            };
            self.eat(Tok::RParen);
            let cblock = self.parse_block();
            catches.push(Catch {
                ty,
                name,
                block: cblock,
            });
        }
        let finally = if self.at_keyword("finally") {
            self.bump();
            Some(self.parse_block())
        } else {
            None
        };
        let end = self.prev_end();
        Some(Stmt::Try {
            block,
            catches,
            finally,
            span: Span { start, end },
        })
    }

    // ---- Expressions (increment 4) ----

    fn parse_expr(&mut self) -> Option<Expr> {
        self.parse_assign()
    }

    fn parse_assign(&mut self) -> Option<Expr> {
        let lhs = self.parse_ternary()?;
        let op = match self.kind() {
            Some(Tok::Assign) => "=",
            Some(Tok::PlusEq) => "+=",
            Some(Tok::MinusEq) => "-=",
            Some(Tok::StarEq) => "*=",
            Some(Tok::SlashEq) => "/=",
            _ => return Some(lhs),
        };
        self.bump();
        let value = self.parse_assign()?;
        let span = Span {
            start: lhs.span().start,
            end: value.span().end,
        };
        Some(Expr::Assign {
            op: op.to_string(),
            target: Box::new(lhs),
            value: Box::new(value),
            span,
        })
    }

    fn parse_ternary(&mut self) -> Option<Expr> {
        let cond = self.parse_binary(0)?;
        if self.kind() == Some(Tok::Question) {
            self.bump();
            let then = self.parse_assign()?;
            self.eat(Tok::Colon);
            let els = self.parse_assign()?;
            let span = Span {
                start: cond.span().start,
                end: els.span().end,
            };
            return Some(Expr::Ternary {
                cond: Box::new(cond),
                then: Box::new(then),
                els: Box::new(els),
                span,
            });
        }
        Some(cond)
    }

    /// Precedence-climbing binary parser. `instanceof` sits at the relational level.
    fn parse_binary(&mut self, min_prec: u8) -> Option<Expr> {
        let mut lhs = self.parse_unary()?;
        loop {
            if self.at_keyword("instanceof") && min_prec <= 7 {
                self.bump();
                let (ty, sp) = self
                    .parse_type_ref()
                    .unwrap_or((String::new(), Span::default()));
                let span = Span {
                    start: lhs.span().start,
                    end: sp.end,
                };
                lhs = Expr::Binary {
                    op: "instanceof".to_string(),
                    lhs: Box::new(lhs),
                    rhs: Box::new(Expr::Name(ty, sp)),
                    span,
                };
                continue;
            }
            let Some((op, prec)) = self.binary_op() else {
                break;
            };
            if prec < min_prec {
                break;
            }
            self.bump();
            let rhs = self.parse_binary(prec + 1)?;
            let span = Span {
                start: lhs.span().start,
                end: rhs.span().end,
            };
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
                span,
            };
        }
        Some(lhs)
    }

    /// The current token as a binary operator (text, precedence), if any.
    fn binary_op(&self) -> Option<(String, u8)> {
        let t = self.peek()?;
        let (op, prec) = match t.kind {
            Tok::OrOr => ("||", 1),
            Tok::AndAnd => ("&&", 2),
            Tok::Pipe => ("|", 3),
            Tok::Caret => ("^", 4),
            Tok::Amp => ("&", 5),
            Tok::Eq => ("==", 6),
            Tok::Ne => ("!=", 6),
            Tok::Lt => ("<", 7),
            Tok::Le => ("<=", 7),
            Tok::Gt => (">", 7),
            Tok::Ge => (">=", 7),
            Tok::Plus => ("+", 8),
            Tok::Minus => ("-", 8),
            Tok::Star => ("*", 9),
            Tok::Slash => ("/", 9),
            Tok::Percent => ("%", 9),
            _ => return None,
        };
        Some((op.to_string(), prec))
    }

    fn parse_unary(&mut self) -> Option<Expr> {
        let t = self.peek()?;
        let start = t.start;
        match t.kind {
            Tok::Bang | Tok::Minus | Tok::Plus | Tok::Inc | Tok::Dec => {
                let op = self.text(t).to_string();
                self.bump();
                let operand = self.parse_unary()?;
                let span = Span {
                    start,
                    end: operand.span().end,
                };
                Some(Expr::Unary {
                    op,
                    prefix: true,
                    operand: Box::new(operand),
                    span,
                })
            }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> Option<Expr> {
        let mut e = self.parse_primary()?;
        loop {
            match self.kind() {
                Some(Tok::Dot) => {
                    self.bump();
                    let name = match self.peek() {
                        Some(t) if t.kind == Tok::Ident || t.kind == Tok::Keyword => {
                            let s = self.text(t).to_string();
                            self.bump();
                            s
                        }
                        _ => String::new(),
                    };
                    let span = Span {
                        start: e.span().start,
                        end: self.prev_end(),
                    };
                    e = Expr::Member {
                        target: Box::new(e),
                        name,
                        span,
                    };
                }
                Some(Tok::LParen) => {
                    let args = self.parse_args();
                    let span = Span {
                        start: e.span().start,
                        end: self.prev_end(),
                    };
                    e = Expr::Call {
                        callee: Box::new(e),
                        args,
                        span,
                    };
                }
                Some(Tok::LBracket) => {
                    self.bump();
                    let idx = self.parse_expr().unwrap_or(Expr::Error(Span::default()));
                    self.eat(Tok::RBracket);
                    let span = Span {
                        start: e.span().start,
                        end: self.prev_end(),
                    };
                    e = Expr::Index {
                        target: Box::new(e),
                        index: Box::new(idx),
                        span,
                    };
                }
                Some(Tok::Inc) | Some(Tok::Dec) => {
                    let tok = self.peek().unwrap();
                    let op = self.text(tok).to_string();
                    let end = tok.end;
                    self.bump();
                    let span = Span {
                        start: e.span().start,
                        end,
                    };
                    e = Expr::Unary {
                        op,
                        prefix: false,
                        operand: Box::new(e),
                        span,
                    };
                }
                _ => break,
            }
        }
        Some(e)
    }

    fn parse_args(&mut self) -> Vec<Expr> {
        let mut args = Vec::new();
        if !self.eat(Tok::LParen) {
            return args;
        }
        while let Some(t) = self.peek() {
            if t.kind == Tok::RParen {
                self.bump();
                break;
            }
            if let Some(e) = self.parse_expr() {
                args.push(e);
            } else {
                self.bump();
            }
            self.eat(Tok::Comma);
        }
        args
    }

    fn parse_primary(&mut self) -> Option<Expr> {
        let t = self.peek()?;
        let sp = Span {
            start: t.start,
            end: t.end,
        };
        let lit = |k| Some((k, sp));
        let kind_lit = match t.kind {
            Tok::IntLit => lit(LitKind::Int),
            Tok::LongLit => lit(LitKind::Long),
            Tok::DecimalLit => lit(LitKind::Decimal),
            Tok::StringLit => lit(LitKind::Str),
            Tok::BoolLit => lit(LitKind::Bool),
            Tok::NullLit => lit(LitKind::Null),
            _ => None,
        };
        if let Some((k, s)) = kind_lit {
            self.bump();
            return Some(Expr::Lit(k, s));
        }
        match t.kind {
            Tok::Ident => {
                let n = self.text(t).to_string();
                self.bump();
                Some(Expr::Name(n, sp))
            }
            Tok::Keyword if self.text(t).eq_ignore_ascii_case("this") => {
                self.bump();
                Some(Expr::This(sp))
            }
            Tok::Keyword if self.text(t).eq_ignore_ascii_case("super") => {
                self.bump();
                Some(Expr::Super(sp))
            }
            Tok::Keyword if self.text(t).eq_ignore_ascii_case("new") => self.parse_new(),
            Tok::LParen => self.parse_paren_or_cast(),
            _ => {
                self.bump();
                Some(Expr::Error(sp))
            }
        }
    }

    fn parse_new(&mut self) -> Option<Expr> {
        let start = self.bump()?.start; // new
        let (ty, tysp) = self
            .parse_type_ref()
            .unwrap_or((String::new(), Span { start, end: start }));
        let mut args = Vec::new();
        let mut end = tysp.end;
        match self.kind() {
            Some(Tok::LParen) => {
                args = self.parse_args();
                end = self.prev_end();
            }
            Some(Tok::LBrace) => {
                // Collection / map initializer: `{a, b}` or `{k => v}`.
                self.bump();
                while let Some(t) = self.peek() {
                    if t.kind == Tok::RBrace {
                        end = t.end;
                        self.bump();
                        break;
                    }
                    if let Some(e) = self.parse_expr() {
                        args.push(e);
                    } else {
                        self.bump();
                    }
                    if self.eat(Tok::FatArrow) {
                        if let Some(v) = self.parse_expr() {
                            args.push(v);
                        }
                    }
                    self.eat(Tok::Comma);
                }
            }
            Some(Tok::LBracket) => {
                end = self.skip_balanced(Tok::LBracket, Tok::RBracket);
                if self.kind() == Some(Tok::LBrace) {
                    end = self.skip_balanced(Tok::LBrace, Tok::RBrace);
                }
            }
            _ => {}
        }
        Some(Expr::New {
            ty,
            args,
            span: Span { start, end },
        })
    }

    /// `( expr )` or a `(Type) expr` cast.
    fn parse_paren_or_cast(&mut self) -> Option<Expr> {
        let start = self.peek()?.start;
        self.bump(); // (

        // Cast lookahead: `Type )` followed by an expression-starting token.
        let probe = self.pos;
        let is_cast = self.parse_type_ref().is_some()
            && self.kind() == Some(Tok::RParen)
            && self
                .peek_at(1)
                .is_some_and(|t| begins_expr_kind(t.kind, t.text(self.src)));
        self.pos = probe;

        if is_cast {
            let (ty, _) = self.parse_type_ref().unwrap();
            self.bump(); // )
            let operand = self.parse_unary()?;
            let span = Span {
                start,
                end: operand.span().end,
            };
            return Some(Expr::Cast {
                ty,
                expr: Box::new(operand),
                span,
            });
        }

        let e = self
            .parse_expr()
            .unwrap_or(Expr::Error(Span { start, end: start }));
        let mut end = e.span().end;
        if self.kind() == Some(Tok::RParen) {
            end = self.peek().unwrap().end;
            self.bump();
        }
        Some(Expr::Paren(Box::new(e), Span { start, end }))
    }
}

/// Whether a token kind (with its text, for keywords) can begin an expression.
fn begins_expr_kind(k: Tok, text: &str) -> bool {
    matches!(
        k,
        Tok::Ident
            | Tok::IntLit
            | Tok::LongLit
            | Tok::DecimalLit
            | Tok::StringLit
            | Tok::BoolLit
            | Tok::NullLit
            | Tok::LParen
            | Tok::Bang
            | Tok::Minus
            | Tok::Plus
            | Tok::Inc
            | Tok::Dec
    ) || (k == Tok::Keyword
        && matches!(text.to_ascii_lowercase().as_str(), "new" | "this" | "super"))
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
            let b = m.body.as_ref().unwrap();
            assert_eq!(&src[b.span.start..b.span.end], "{ Integer y = 1; }");
            assert_eq!(b.stmts.len(), 1);
            assert!(
                matches!(&b.stmts[0], Stmt::LocalVar { ty, decls, .. } if ty == "Integer" && decls[0].0 == "y")
            );
        } else {
            panic!("expected method");
        }
    }

    // ---- increment 4: statements + expressions ----

    fn body(src: &str) -> Block {
        let cu = parse(src);
        match &cu.types[0].members[0] {
            Member::Method(m) => m.body.clone().expect("body"),
            _ => panic!("expected method"),
        }
    }

    fn wrap(stmts: &str) -> Block {
        body(&format!("class C {{ void m() {{ {stmts} }} }}"))
    }

    #[test]
    fn parses_local_var_with_init_and_multi() {
        let b = wrap("Integer a = 1, b; String s = 'x';");
        assert_eq!(b.stmts.len(), 2);
        match &b.stmts[0] {
            Stmt::LocalVar { ty, decls, .. } => {
                assert_eq!(ty, "Integer");
                assert_eq!(decls.len(), 2);
                assert!(matches!(&decls[0], (n, Some(Expr::Lit(LitKind::Int, _))) if n == "a"));
                assert!(matches!(&decls[1], (n, None) if n == "b"));
            }
            s => panic!("{s:?}"),
        }
    }

    #[test]
    fn parses_call_and_member_chain() {
        let b = wrap("System.debug(x.name);");
        assert_eq!(b.stmts.len(), 1);
        // System.debug(...) → Call(callee = Member(System, debug), args=[Member(x,name)])
        let Stmt::Expr(Expr::Call { callee, args, .. }) = &b.stmts[0] else {
            panic!("{:?}", b.stmts[0]);
        };
        assert!(matches!(&**callee, Expr::Member { name, .. } if name == "debug"));
        assert_eq!(args.len(), 1);
        assert!(matches!(&args[0], Expr::Member { name, .. } if name == "name"));
    }

    #[test]
    fn binary_precedence_groups_mul_over_add() {
        // a + b * c → Binary(+, a, Binary(*, b, c))
        let b = wrap("x = a + b * c;");
        let Stmt::Expr(Expr::Assign { value, .. }) = &b.stmts[0] else {
            panic!()
        };
        let Expr::Binary { op, rhs, .. } = &**value else {
            panic!("{value:?}")
        };
        assert_eq!(op, "+");
        assert!(matches!(&**rhs, Expr::Binary { op, .. } if op == "*"));
    }

    #[test]
    fn parses_if_else() {
        let b = wrap("if (a > 0) { return; } else doIt();");
        let Stmt::If {
            cond, then, els, ..
        } = &b.stmts[0]
        else {
            panic!("{:?}", b.stmts[0])
        };
        assert!(matches!(cond, Expr::Binary { op, .. } if op == ">"));
        assert!(matches!(&**then, Stmt::Block(_)));
        assert!(els.is_some());
    }

    #[test]
    fn parses_for_each_and_c_style() {
        let fe = wrap("for (Account a : accts) { a.x = 1; }");
        assert!(
            matches!(&fe.stmts[0], Stmt::ForEach { ty, name, .. } if ty == "Account" && name == "a")
        );
        let cf = wrap("for (Integer i = 0; i < 10; i++) sum += i;");
        assert!(matches!(
            &cf.stmts[0],
            Stmt::For {
                init: Some(_),
                cond: Some(_),
                update: Some(_),
                ..
            }
        ));
    }

    #[test]
    fn parses_try_catch_finally() {
        let b = wrap("try { risky(); } catch (Exception e) { log(e); } finally { cleanup(); }");
        let Stmt::Try {
            catches, finally, ..
        } = &b.stmts[0]
        else {
            panic!("{:?}", b.stmts[0])
        };
        assert_eq!(catches.len(), 1);
        assert_eq!(catches[0].ty, "Exception");
        assert_eq!(catches[0].name, "e");
        assert!(finally.is_some());
    }

    #[test]
    fn parses_dml_and_new_and_cast() {
        let b = wrap("insert new Account(Name = 'A'); Id x = (Id) ref;");
        assert!(matches!(&b.stmts[0], Stmt::Dml { op, .. } if op == "insert"));
        let Stmt::Dml { expr, .. } = &b.stmts[0] else {
            panic!()
        };
        assert!(matches!(expr, Expr::New { ty, .. } if ty == "Account"));
        // local var initialized with a cast
        assert!(
            matches!(&b.stmts[1], Stmt::LocalVar { decls, .. } if matches!(&decls[0].1, Some(Expr::Cast { ty, .. }) if ty == "Id"))
        );
    }

    #[test]
    fn parses_ternary_and_postfix() {
        let b = wrap("x = a ? b : c; i++;");
        assert!(
            matches!(&b.stmts[0], Stmt::Expr(Expr::Assign { value, .. }) if matches!(&**value, Expr::Ternary { .. }))
        );
        assert!(
            matches!(&b.stmts[1], Stmt::Expr(Expr::Unary { op, prefix: false, .. }) if op == "++")
        );
    }

    #[test]
    fn method_body_does_not_panic_on_partial_statements() {
        for s in [
            "if (",
            "for (Integer i",
            "return",
            "x.",
            "new ",
            "(Id)",
            "try {",
        ] {
            let _ = wrap(s);
        }
    }

    #[test]
    fn end_to_end_parses_a_realistic_class() {
        // A representative class exercising the whole Phase-1 grammar end to end.
        let src = r#"
@RestResource(urlMapping='/x')
public with sharing class AccountService implements Callable {
    private static final Integer LIMIT_SIZE = 200;
    public Integer total { get; private set; }

    public AccountService(Integer seed) {
        this.total = seed;
    }

    @AuraEnabled
    public List<Account> top(String industry) {
        List<Account> out = new List<Account>();
        for (Account a : accts) {
            if (a.AnnualRevenue != null && a.AnnualRevenue > 0) {
                out.add(a);
                total++;
            } else {
                continue;
            }
        }
        try {
            insert out;
        } catch (DmlException e) {
            System.debug(LoggingLevel.ERROR, e.getMessage());
            throw e;
        } finally {
            total = (Integer) Math.min(total, LIMIT_SIZE);
        }
        return out.isEmpty() ? null : out;
    }

    public enum Status { ACTIVE, CLOSED }
}
"#;
        let cu = parse(src);
        assert!(
            cu.errors.is_empty(),
            "unexpected parse errors: {:?}",
            cu.errors
        );
        assert_eq!(cu.types.len(), 1);
        let t = &cu.types[0];
        assert_eq!(t.name, "AccountService");
        assert_eq!(t.annotations, vec!["RestResource"]);
        assert_eq!(t.modifiers, vec!["public", "with sharing"]);
        assert_eq!(t.implements, vec!["Callable"]);

        assert!(t
            .members
            .iter()
            .any(|m| matches!(m, Member::Field(f) if f.name == "LIMIT_SIZE")));
        assert!(t
            .members
            .iter()
            .any(|m| matches!(m, Member::Property(p) if p.name == "total")));
        assert!(t
            .members
            .iter()
            .any(|m| matches!(m, Member::Method(m) if m.name == "AccountService" && m.return_type.is_none())));
        assert!(t.members.iter().any(|m| matches!(m, Member::Nested(n)
            if n.kind == TypeKind::Enum
                && n.enum_constants == vec!["ACTIVE".to_string(), "CLOSED".to_string()])));

        let top = t
            .members
            .iter()
            .find_map(|m| match m {
                Member::Method(m) if m.name == "top" => Some(m),
                _ => None,
            })
            .expect("top method");
        let stmts = &top.body.as_ref().unwrap().stmts;
        assert!(matches!(stmts[0], Stmt::LocalVar { .. }));
        assert!(stmts.iter().any(|s| matches!(s, Stmt::ForEach { .. })));
        assert!(stmts.iter().any(|s| matches!(s, Stmt::Try { .. })));
        assert!(matches!(
            stmts.last().unwrap(),
            Stmt::Return(Some(Expr::Ternary { .. }), _)
        ));
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
