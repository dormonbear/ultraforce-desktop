//! Token-based cursor-context classification for the wiring layer: what kind of
//! completion does the caret want, and (for on-demand type acquisition) which
//! type's members does it need. Ported from the legacy heuristic parser onto
//! the AST lexer; deliberately cheap — full type inference lives in
//! [`super::infer`], this only routes.

use super::lexer::{lex_code, Tok, Token};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalVar {
    pub name: String,
    pub declared_type: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApexOutline {
    pub locals: Vec<LocalVar>,
}

/// One link in a receiver chain: `name` plus whether it is a call `name(...)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub name: String,
    pub is_call: bool,
}

/// What the caret position wants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorContext {
    /// After `.`: members of the receiver chain's type.
    Member { chain: Vec<Segment>, prefix: String },
    /// Naming a new variable after its type: offer names, never types.
    DeclaratorName { type_text: String, prefix: String },
    /// After `@`: annotation names.
    Annotation { prefix: String },
    /// After `new`: type names only.
    TypeOnly { prefix: String },
    /// Statement/expression position: types + keywords + in-scope names.
    Bare { prefix: String },
    /// Nothing to offer.
    Unknown,
}

/// Collect `Type name;` local declarations by token scanning (no parse). Only
/// simple and dotted types — generics are intentionally skipped; the AST
/// engine's scope pass covers those.
pub fn outline(input: &str) -> ApexOutline {
    let tokens = lex_code(input);
    let mut locals = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        if tokens[i].kind == Tok::Ident {
            // Greedily consume `Ident (Dot Ident)*` as a (possibly dotted) type.
            let mut type_text = tokens[i].text(input).to_string();
            let mut last = i;
            while last + 2 < tokens.len()
                && tokens[last + 1].kind == Tok::Dot
                && tokens[last + 2].kind == Tok::Ident
            {
                type_text.push('.');
                type_text.push_str(tokens[last + 2].text(input));
                last += 2;
            }
            // The next ident after the type is the variable name.
            if last + 1 < tokens.len() {
                let name_idx = last + 1;
                if tokens[name_idx].kind == Tok::Ident
                    && statement_has_semicolon(&tokens, name_idx + 1)
                {
                    locals.push(LocalVar {
                        declared_type: type_text,
                        name: tokens[name_idx].text(input).to_string(),
                    });
                }
                i = name_idx;
            } else {
                i = last;
            }
        }
        i += 1;
    }

    ApexOutline { locals }
}

/// Classify the caret at `cursor`.
pub fn context_at(input: &str, cursor: usize) -> CursorContext {
    let cursor = cursor.min(input.len());
    let bytes = input.as_bytes();
    let mut prefix_start = cursor;
    while prefix_start > 0 && is_ident_byte(bytes[prefix_start - 1]) {
        prefix_start -= 1;
    }
    let prefix = input[prefix_start..cursor].to_string();

    // Annotation: the identifier being typed is introduced by `@`.
    if prefix_start > 0 && bytes[prefix_start - 1] == b'@' {
        return CursorContext::Annotation { prefix };
    }

    let toks = lex_code(&input[..prefix_start]);

    // Member access: the token right before the (possibly EMPTY) prefix is a
    // `.`. Checking this before anything else is what lets `Foo.` and `a.`
    // complete the instant the `.` trigger fires (nothing typed yet).
    if toks.last().is_some_and(|t| t.kind == Tok::Dot) {
        let chain = extract_chain(&toks, input);
        if chain.is_empty() {
            return CursorContext::Unknown;
        }
        return CursorContext::Member { chain, prefix };
    }

    // Variable-declaration name position (`Type ident<caret>`): suggest names,
    // not types. Detected even with an empty prefix (right after the type).
    if let Some((start, end)) = declarator_type_range(&toks) {
        return CursorContext::DeclaratorName {
            type_text: input[start..end].to_string(),
            prefix,
        };
    }

    // `new <caret>`: type names only.
    if toks
        .last()
        .is_some_and(|t| t.kind == Tok::Keyword && t.text(input).eq_ignore_ascii_case("new"))
    {
        return CursorContext::TypeOnly { prefix };
    }

    CursorContext::Bare { prefix }
}

/// The type name whose members the cursor wants, if any — for ensure-describe in
/// the wiring layer. Type-shaped receiver → the type; lowercase receiver → the
/// local's declared type, else the receiver as a type name. Chains and calls →
/// None (resolved post-describe by the AST engine).
pub fn needed_type_at(input: &str, cursor: usize) -> Option<String> {
    match context_at(input, cursor) {
        CursorContext::Member { chain, .. } => match chain.as_slice() {
            [only] if !only.is_call => {
                if is_type_shaped(&only.name) {
                    Some(only.name.clone())
                } else {
                    Some(
                        outline(input)
                            .locals
                            .iter()
                            .find(|l| l.name.eq_ignore_ascii_case(&only.name))
                            .map(|l| l.declared_type.clone())
                            .unwrap_or_else(|| only.name.clone()),
                    )
                }
            }
            _ => None,
        },
        _ => None,
    }
}

/// If the tokens before the caret are a complete type expression sitting at a
/// statement-start position, return its byte range — i.e. the caret is naming a
/// new variable. Handles `Account`, `ns.Type`, and one level of generics
/// (`List<Account>`, `Map<Id, Account>`). Returns `None` otherwise.
fn declarator_type_range(toks: &[Token]) -> Option<(usize, usize)> {
    let last = toks.last()?;
    let end = last.end;

    // Locate the base type identifier, stepping over a trailing `<...>`.
    let base_idx = if last.kind == Tok::Gt {
        let mut depth = 0i32;
        let mut open = None;
        for k in (0..toks.len()).rev() {
            match toks[k].kind {
                Tok::Gt => depth += 1,
                Tok::Lt => {
                    depth -= 1;
                    if depth == 0 {
                        open = Some(k);
                        break;
                    }
                }
                _ => {}
            }
        }
        let open = open?;
        if open == 0 || toks[open - 1].kind != Tok::Ident {
            return None;
        }
        open - 1
    } else if last.kind == Tok::Ident {
        toks.len() - 1
    } else {
        return None;
    };

    // Walk left over a dotted namespace (`Schema.Account`).
    let mut start = base_idx;
    while start >= 2 && toks[start - 1].kind == Tok::Dot && toks[start - 2].kind == Tok::Ident {
        start -= 2;
    }

    // The type must begin a statement / parameter (or the input).
    let boundary = start == 0
        || matches!(
            toks[start - 1].kind,
            Tok::Semi | Tok::LBrace | Tok::RBrace | Tok::LParen | Tok::Comma
        );
    if !boundary {
        return None;
    }

    Some((toks[start].start, end))
}

fn statement_has_semicolon(tokens: &[Token], start: usize) -> bool {
    tokens
        .iter()
        .skip(start)
        .take_while(|t| t.kind != Tok::LBrace && t.kind != Tok::RBrace)
        .any(|t| t.kind == Tok::Semi)
}

/// Walk the receiver chain ending at the trailing `.` (toks.last()). Returns
/// segments left→right. Skips balanced call parens; stops at the first token
/// that is not part of a `Ident (call)? (. Ident (call)?)*` run.
fn extract_chain(toks: &[Token], src: &str) -> Vec<Segment> {
    let mut segs: Vec<Segment> = Vec::new();
    // index of the token just before the trailing dot
    let mut i = match toks.len().checked_sub(2) {
        Some(i) => i as isize,
        None => return segs,
    };
    loop {
        let mut is_call = false;
        // optional call: skip a balanced ) ... (
        if i >= 0 && toks[i as usize].kind == Tok::RParen {
            let mut depth = 0i32;
            while i >= 0 {
                match toks[i as usize].kind {
                    Tok::RParen => depth += 1,
                    Tok::LParen => {
                        depth -= 1;
                        if depth == 0 {
                            i -= 1;
                            break;
                        }
                    }
                    _ => {}
                }
                i -= 1;
            }
            if depth != 0 {
                return Vec::new(); // unbalanced → give up
            }
            is_call = true;
        }
        // the name
        if i >= 0 && toks[i as usize].kind == Tok::Ident {
            segs.push(Segment {
                name: toks[i as usize].text(src).to_string(),
                is_call,
            });
            i -= 1;
        } else {
            // a call with no preceding identifier, or no identifier at all → stop
            break;
        }
        // continue only if another dot precedes this segment
        if i >= 0 && toks[i as usize].kind == Tok::Dot {
            i -= 1;
            continue;
        }
        break;
    }
    segs.reverse();
    segs
}

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn is_type_shaped(text: &str) -> bool {
    text.as_bytes()
        .first()
        .is_some_and(|byte| byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outline_collects_simple_local_declarations() {
        let outline = outline("Account a; Integer n = 0;");

        assert_eq!(
            outline.locals,
            vec![
                LocalVar {
                    name: "a".to_string(),
                    declared_type: "Account".to_string(),
                },
                LocalVar {
                    name: "n".to_string(),
                    declared_type: "Integer".to_string(),
                },
            ]
        );
    }

    #[test]
    fn outline_collects_dotted_declared_type() {
        let o = outline("Outer.Inner x;");
        assert_eq!(
            o.locals,
            vec![LocalVar {
                name: "x".to_string(),
                declared_type: "Outer.Inner".to_string(),
            }]
        );
    }

    #[test]
    fn context_classifies_member_declarator_and_bare() {
        match context_at("String.valO", "String.valO".len()) {
            CursorContext::Member { chain, prefix } => {
                assert_eq!(prefix, "valO");
                assert_eq!(chain.len(), 1);
                assert_eq!(chain[0].name, "String");
                assert!(!chain[0].is_call);
            }
            other => panic!("expected Member, got {other:?}"),
        }
        assert_eq!(
            context_at("Account acc", "Account acc".len()),
            CursorContext::DeclaratorName {
                type_text: "Account".to_string(),
                prefix: "acc".to_string(),
            }
        );
        assert_eq!(
            context_at("Inte", "Inte".len()),
            CursorContext::Bare {
                prefix: "Inte".to_string(),
            }
        );
        assert_eq!(
            context_at("Object o = new Stri", "Object o = new Stri".len()),
            CursorContext::TypeOnly {
                prefix: "Stri".to_string(),
            }
        );
        assert_eq!(
            context_at("@Aura", "@Aura".len()),
            CursorContext::Annotation {
                prefix: "Aura".to_string(),
            }
        );
    }

    #[test]
    fn needed_type_at_returns_receiver_or_static_type() {
        // local's declared type
        let s = "Account a; a.na";
        assert_eq!(needed_type_at(s, s.len()).as_deref(), Some("Account"));
        // static / type receiver
        let t = "String.va";
        assert_eq!(needed_type_at(t, t.len()).as_deref(), Some("String"));
        // top-level prefix -> nothing to describe
        assert_eq!(needed_type_at("Acc", 3), None);
        // chains are resolved post-describe by the AST engine -> None
        assert_eq!(needed_type_at("a.getSelf().", "a.getSelf().".len()), None);
    }

    #[test]
    fn empty_prefix_after_dot_still_classifies_member_access() {
        // The `.` trigger fires with nothing typed yet.
        match context_at("String.", "String.".len()) {
            CursorContext::Member { chain, prefix } => {
                assert_eq!(prefix, "");
                assert_eq!(chain[0].name, "String");
            }
            other => panic!("expected Member, got {other:?}"),
        }
        // Chain with a trailing dot + empty prefix.
        match context_at("a.getSelf().", "a.getSelf().".len()) {
            CursorContext::Member { prefix, chain } => {
                assert_eq!(prefix, "");
                assert_eq!(chain.len(), 2);
                assert_eq!(
                    chain[1],
                    Segment {
                        name: "getSelf".into(),
                        is_call: true
                    }
                );
            }
            other => panic!("expected Member, got {other:?}"),
        }
        // On-demand fetch still resolves the type with an empty prefix.
        assert_eq!(
            needed_type_at("String.", "String.".len()).as_deref(),
            Some("String")
        );
        assert_eq!(
            needed_type_at("Account a; a.", "Account a; a.".len()).as_deref(),
            Some("Account")
        );
    }

    #[test]
    fn chain_member_context_extracts_segments() {
        // svc : base, getSelf() : call segment; completing ".sa"
        let input = "AccountService svc; svc.getSelf().sa";
        match context_at(input, input.len()) {
            CursorContext::Member { chain, prefix } => {
                assert_eq!(prefix, "sa");
                assert_eq!(chain.len(), 2);
                assert_eq!(
                    chain[0],
                    Segment {
                        name: "svc".into(),
                        is_call: false
                    }
                );
                assert_eq!(
                    chain[1],
                    Segment {
                        name: "getSelf".into(),
                        is_call: true
                    }
                );
            }
            other => panic!("expected Member, got {other:?}"),
        }
    }
}
