#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenKind {
    Keyword,
    Ident,
    Dot,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Semicolon,
    Comma,
    Lt,
    Gt,
    Literal,
    Whitespace,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub start: usize,
    pub end: usize,
}

pub fn lex(input: &str) -> Vec<Token> {
    let bytes = input.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        let start = i;
        let byte = bytes[i];
        let kind = match byte {
            b'.' => {
                i += 1;
                TokenKind::Dot
            }
            b'(' => {
                i += 1;
                TokenKind::LParen
            }
            b')' => {
                i += 1;
                TokenKind::RParen
            }
            b'{' => {
                i += 1;
                TokenKind::LBrace
            }
            b'}' => {
                i += 1;
                TokenKind::RBrace
            }
            b';' => {
                i += 1;
                TokenKind::Semicolon
            }
            b',' => {
                i += 1;
                TokenKind::Comma
            }
            b'<' => {
                i += 1;
                TokenKind::Lt
            }
            b'>' => {
                i += 1;
                TokenKind::Gt
            }
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    let current = bytes[i];
                    i += 1;
                    if current == b'\'' {
                        break;
                    }
                }
                TokenKind::Literal
            }
            b if b.is_ascii_whitespace() => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                TokenKind::Whitespace
            }
            b if b.is_ascii_digit() => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                TokenKind::Literal
            }
            b if is_ident_start(b) => {
                i += 1;
                while i < bytes.len() && is_ident_continue(bytes[i]) {
                    i += 1;
                }
                if is_keyword(&input[start..i]) {
                    TokenKind::Keyword
                } else {
                    TokenKind::Ident
                }
            }
            _ => {
                i += 1;
                TokenKind::Other
            }
        };

        tokens.push(Token {
            kind,
            text: input[start..i].to_string(),
            start,
            end: i,
        });
    }

    tokens
}

fn is_ident_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

fn is_ident_continue(byte: u8) -> bool {
    is_ident_start(byte) || byte.is_ascii_digit()
}

fn is_keyword(text: &str) -> bool {
    matches!(
        text.to_ascii_lowercase().as_str(),
        "abstract"
            | "break"
            | "catch"
            | "class"
            | "continue"
            | "do"
            | "else"
            | "enum"
            | "extends"
            | "final"
            | "for"
            | "global"
            | "if"
            | "implements"
            | "interface"
            | "new"
            | "override"
            | "private"
            | "protected"
            | "public"
            | "return"
            | "static"
            | "super"
            | "this"
            | "throw"
            | "try"
            | "virtual"
            | "void"
            | "webservice"
            | "while"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexes_apex_tokens_with_byte_spans() {
        let input = "Integer x = String.valueOf(1);";
        let tokens = lex(input);
        let pairs: Vec<_> = tokens
            .iter()
            .map(|token| (token.kind.clone(), token.text.as_str()))
            .collect();

        assert_eq!(
            pairs,
            vec![
                (TokenKind::Ident, "Integer"),
                (TokenKind::Whitespace, " "),
                (TokenKind::Ident, "x"),
                (TokenKind::Whitespace, " "),
                (TokenKind::Other, "="),
                (TokenKind::Whitespace, " "),
                (TokenKind::Ident, "String"),
                (TokenKind::Dot, "."),
                (TokenKind::Ident, "valueOf"),
                (TokenKind::LParen, "("),
                (TokenKind::Literal, "1"),
                (TokenKind::RParen, ")"),
                (TokenKind::Semicolon, ";"),
            ]
        );

        let string = tokens.iter().find(|token| token.text == "String").unwrap();
        assert_eq!(&input[string.start..string.end], "String");
    }

    #[test]
    fn lexes_keywords_case_insensitively() {
        let tokens = lex("new ");

        assert_eq!(tokens[0].kind, TokenKind::Keyword);
        assert_eq!(tokens[0].text, "new");
    }
}
