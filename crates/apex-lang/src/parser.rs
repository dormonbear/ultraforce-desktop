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
    Unknown,
}

pub fn outline(input: &str) -> ApexOutline {
    let tokens = lex(input);
    let mut locals = Vec::new();
    let mut i = 0;

    while i + 1 < tokens.len() {
        if tokens[i].kind == TokenKind::Ident {
            if let Some(name_idx) = next_non_ws(&tokens, i + 1) {
                if tokens[name_idx].kind == TokenKind::Ident
                    && statement_has_semicolon(&tokens, name_idx + 1)
                {
                    locals.push(LocalVar {
                        declared_type: tokens[i].text.clone(),
                        name: tokens[name_idx].text.clone(),
                    });
                }
                i = name_idx;
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
    if prefix.is_empty() {
        return CursorContext::Unknown;
    }

    let before_prefix = lex(&input[..prefix_start]);
    let non_ws: Vec<&Token> = before_prefix
        .iter()
        .filter(|token| token.kind != TokenKind::Whitespace)
        .collect();

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

    CursorContext::TopLevel {
        prefix: prefix.to_string(),
    }
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
    byte.is_ascii_alphanumeric() || byte == b'_'
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
