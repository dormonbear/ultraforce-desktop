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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorContext {
    TopLevel { prefix: String },
    StaticMember { type_name: String, prefix: String },
    InstanceMember { receiver: String, prefix: String },
    Unknown,
}

pub fn outline(input: &str) -> ApexOutline {
    let tokens = lex(input);
    let mut locals = Vec::new();
    let mut i = 0;

    while i + 1 < tokens.len() {
        if tokens[i].kind == TokenKind::Ident {
            if let Some(name_idx) = next_non_ws(&tokens, i + 1) {
                if tokens[name_idx].kind == TokenKind::Ident {
                    if statement_has_semicolon(&tokens, name_idx + 1) {
                        locals.push(LocalVar {
                            declared_type: tokens[i].text.clone(),
                            name: tokens[name_idx].text.clone(),
                        });
                    }
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

    if non_ws.last().is_some_and(|token| token.kind == TokenKind::Dot) {
        if let Some(receiver) = non_ws.iter().rev().nth(1) {
            if receiver.kind == TokenKind::Ident {
                if is_type_shaped(&receiver.text) {
                    return CursorContext::StaticMember {
                        type_name: receiver.text.clone(),
                        prefix: prefix.to_string(),
                    };
                }
                return CursorContext::InstanceMember {
                    receiver: receiver.text.clone(),
                    prefix: prefix.to_string(),
                };
            }
        }
        return CursorContext::Unknown;
    }

    CursorContext::TopLevel {
        prefix: prefix.to_string(),
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
}
