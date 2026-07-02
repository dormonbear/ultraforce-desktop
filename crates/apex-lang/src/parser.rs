use crate::lexer::{lex, Token, TokenKind};

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorContext {
    TopLevel { prefix: String },
    StaticMember { type_name: String, prefix: String },
    InstanceMember { receiver: String, prefix: String },
    ChainMember { chain: Vec<Segment>, prefix: String },
    /// The caret is naming a new variable: `Type ident<caret>`. Offer variable
    /// names, never type names. `type_text` is the declared type as written.
    DeclaratorName { type_text: String, prefix: String },
    Unknown,
}

pub fn outline(input: &str) -> ApexOutline {
    let tokens = lex(input);
    let mut locals = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        if tokens[i].kind == TokenKind::Ident {
            // Greedily consume `Ident (Dot Ident)*` as a (possibly dotted) type.
            let mut type_text = tokens[i].text.clone();
            let mut last = i;
            while let Some(dot) = next_non_ws(&tokens, last + 1) {
                if tokens[dot].kind != TokenKind::Dot {
                    break;
                }
                let Some(seg) = next_non_ws(&tokens, dot + 1) else {
                    break;
                };
                if tokens[seg].kind != TokenKind::Ident {
                    break;
                }
                type_text.push('.');
                type_text.push_str(&tokens[seg].text);
                last = seg;
            }
            // The next ident after the type is the variable name.
            if let Some(name_idx) = next_non_ws(&tokens, last + 1) {
                if tokens[name_idx].kind == TokenKind::Ident
                    && statement_has_semicolon(&tokens, name_idx + 1)
                {
                    locals.push(LocalVar {
                        declared_type: type_text,
                        name: tokens[name_idx].text.clone(),
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

pub fn context_at(input: &str, cursor: usize) -> CursorContext {
    let cursor = cursor.min(input.len());
    let mut prefix_start = cursor;
    let bytes = input.as_bytes();
    while prefix_start > 0 && is_ident_continue(bytes[prefix_start - 1]) {
        prefix_start -= 1;
    }
    let prefix = &input[prefix_start..cursor];

    let before_prefix = lex(&input[..prefix_start]);
    let non_ws: Vec<&Token> = before_prefix
        .iter()
        .filter(|token| token.kind != TokenKind::Whitespace)
        .collect();

    // Member access: the token right before the (possibly EMPTY) prefix is a
    // `.`. Checking this before the empty-prefix bail-out is what lets `Foo.`
    // and `a.` complete the instant the `.` trigger fires (nothing typed yet).
    if non_ws
        .last()
        .is_some_and(|token| token.kind == TokenKind::Dot)
    {
        let chain = extract_chain(&non_ws);
        return match chain.as_slice() {
            [only] if !only.is_call => {
                if is_type_shaped(&only.name) {
                    CursorContext::StaticMember {
                        type_name: only.name.clone(),
                        prefix: prefix.to_string(),
                    }
                } else {
                    CursorContext::InstanceMember {
                        receiver: only.name.clone(),
                        prefix: prefix.to_string(),
                    }
                }
            }
            [] => CursorContext::Unknown,
            _ => CursorContext::ChainMember {
                chain,
                prefix: prefix.to_string(),
            },
        };
    }

    // Variable-declaration name position (`Type ident<caret>`): suggest names,
    // not types. Detected even with an empty prefix (right after the type).
    if let Some((start, end)) = declarator_type_range(&non_ws) {
        return CursorContext::DeclaratorName {
            type_text: input[start..end].to_string(),
            prefix: prefix.to_string(),
        };
    }

    // Not member access: an empty prefix here has nothing to complete.
    if prefix.is_empty() {
        return CursorContext::Unknown;
    }

    CursorContext::TopLevel {
        prefix: prefix.to_string(),
    }
}

/// If the tokens before the caret are a complete type expression sitting at a
/// statement-start position, return its byte range — i.e. the caret is naming a
/// new variable. Handles `Account`, `ns.Type`, and one level of generics
/// (`List<Account>`, `Map<Id, Account>`). Returns `None` otherwise.
fn declarator_type_range(non_ws: &[&Token]) -> Option<(usize, usize)> {
    let last = non_ws.last()?;
    let end = last.end;

    // Locate the base type identifier, stepping over a trailing `<...>`.
    let base_idx = if last.text == ">" {
        let mut depth = 0i32;
        let mut open = None;
        for k in (0..non_ws.len()).rev() {
            match non_ws[k].text.as_str() {
                ">" => depth += 1,
                "<" => {
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
        if open == 0 || non_ws[open - 1].kind != TokenKind::Ident {
            return None;
        }
        open - 1
    } else if last.kind == TokenKind::Ident {
        non_ws.len() - 1
    } else {
        return None;
    };

    // Walk left over a dotted namespace (`Schema.Account`).
    let mut start = base_idx;
    while start >= 2
        && non_ws[start - 1].text == "."
        && non_ws[start - 2].kind == TokenKind::Ident
    {
        start -= 2;
    }

    // The type must begin a statement / parameter (or the input).
    let boundary = start == 0
        || matches!(non_ws[start - 1].text.as_str(), ";" | "{" | "}")
        || non_ws[start - 1].kind == TokenKind::LParen
        || non_ws[start - 1].kind == TokenKind::Comma;
    if !boundary {
        return None;
    }

    Some((non_ws[start].start, end))
}

/// The type name whose members the cursor wants, if any -- for ensure-describe in the wiring layer.
/// `StaticMember` -> the type; `InstanceMember` -> the local's declared type, else the receiver as a
/// type name. `TopLevel`/`ChainMember`/`Unknown` -> None (chains are resolved post-describe later).
pub fn needed_type_at(input: &str, cursor: usize) -> Option<String> {
    let o = outline(input);
    match context_at(input, cursor) {
        CursorContext::StaticMember { type_name, .. } => Some(type_name),
        CursorContext::InstanceMember { receiver, .. } => Some(
            o.locals
                .iter()
                .find(|l| l.name.eq_ignore_ascii_case(&receiver))
                .map(|l| l.declared_type.clone())
                .unwrap_or(receiver),
        ),
        _ => None,
    }
}

fn next_non_ws(tokens: &[Token], start: usize) -> Option<usize> {
    tokens
        .iter()
        .enumerate()
        .skip(start)
        .find(|(_, token)| token.kind != TokenKind::Whitespace)
        .map(|(idx, _)| idx)
}

fn statement_has_semicolon(tokens: &[Token], start: usize) -> bool {
    tokens
        .iter()
        .skip(start)
        .take_while(|token| token.kind != TokenKind::LBrace && token.kind != TokenKind::RBrace)
        .any(|token| token.kind == TokenKind::Semicolon)
}

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
                return Vec::new();
            } // unbalanced → give up
            is_call = true;
        }
        // the name
        if i >= 0 && non_ws[i as usize].kind == TokenKind::Ident {
            segs.push(Segment {
                name: non_ws[i as usize].text.clone(),
                is_call,
            });
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

fn is_ident_continue(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'@'
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
    fn context_classifies_static_instance_and_top_level_prefixes() {
        assert_eq!(
            context_at("String.valO", "String.valO".len()),
            CursorContext::StaticMember {
                type_name: "String".to_string(),
                prefix: "valO".to_string(),
            }
        );
        assert_eq!(
            context_at("a.nam", "a.nam".len()),
            CursorContext::InstanceMember {
                receiver: "a".to_string(),
                prefix: "nam".to_string(),
            }
        );
        assert_eq!(
            context_at("Inte", "Inte".len()),
            CursorContext::TopLevel {
                prefix: "Inte".to_string(),
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
    }

    #[test]
    fn empty_prefix_after_dot_still_classifies_member_access() {
        // The `.` trigger fires with nothing typed yet.
        assert_eq!(
            context_at("String.", "String.".len()),
            CursorContext::StaticMember {
                type_name: "String".to_string(),
                prefix: String::new(),
            }
        );
        assert_eq!(
            context_at("Account a; a.", "Account a; a.".len()),
            CursorContext::InstanceMember {
                receiver: "a".to_string(),
                prefix: String::new(),
            }
        );
        // Chain with a trailing dot + empty prefix.
        match context_at("a.getSelf().", "a.getSelf().".len()) {
            CursorContext::ChainMember { prefix, chain } => {
                assert_eq!(prefix, "");
                assert_eq!(chain.len(), 2);
            }
            other => panic!("expected ChainMember, got {other:?}"),
        }
        // Empty prefix NOT after a dot stays Unknown.
        assert_eq!(
            context_at("Integer x = ", "Integer x = ".len()),
            CursorContext::Unknown
        );
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
            CursorContext::ChainMember { chain, prefix } => {
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

}
