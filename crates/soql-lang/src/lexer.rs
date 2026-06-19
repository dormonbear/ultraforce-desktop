//! SOQL lexer: classify tokens with byte spans.

/// Kinds of tokens the lexer emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Keyword,
    Ident,
    Comma,
    Dot,
    LParen,
    RParen,
    Star,
    Whitespace,
    Other,
}

/// A lexed token with its source text and byte span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub start: usize,
    pub end: usize,
}

/// Case-insensitive SOQL keyword set.
const KEYWORDS: &[&str] = &[
    "SELECT",
    "FROM",
    "WHERE",
    "AND",
    "OR",
    "NOT",
    "ORDER",
    "BY",
    "GROUP",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "ASC",
    "DESC",
    "NULLS",
    "FIRST",
    "LAST",
    "LIKE",
    "IN",
    "WITH",
    "FOR",
    "UPDATE",
    "VIEW",
    "REFERENCE",
    "TYPEOF",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
];

fn is_keyword(word: &str) -> bool {
    KEYWORDS.iter().any(|k| k.eq_ignore_ascii_case(word))
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_ident_continue(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Lex `input` into a flat list of tokens with byte spans.
pub fn lex(input: &str) -> Vec<Token> {
    let bytes = input.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c.is_ascii_whitespace() {
            let start = i;
            while i < bytes.len() && (bytes[i] as char).is_ascii_whitespace() {
                i += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Whitespace,
                text: input[start..i].to_string(),
                start,
                end: i,
            });
        } else if is_ident_start(c) {
            let start = i;
            while i < bytes.len() && is_ident_continue(bytes[i] as char) {
                i += 1;
            }
            let text = &input[start..i];
            let kind = if is_keyword(text) {
                TokenKind::Keyword
            } else {
                TokenKind::Ident
            };
            tokens.push(Token {
                kind,
                text: text.to_string(),
                start,
                end: i,
            });
        } else {
            let kind = match c {
                ',' => TokenKind::Comma,
                '.' => TokenKind::Dot,
                '(' => TokenKind::LParen,
                ')' => TokenKind::RParen,
                '*' => TokenKind::Star,
                _ => TokenKind::Other,
            };
            tokens.push(Token {
                kind,
                text: c.to_string(),
                start: i,
                end: i + 1,
            });
            i += 1;
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexes_simple_select() {
        let input = "SELECT Id, Name FROM Account";
        let toks = lex(input);
        let kinds: Vec<TokenKind> = toks.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                TokenKind::Keyword, // SELECT
                TokenKind::Whitespace,
                TokenKind::Ident, // Id
                TokenKind::Comma,
                TokenKind::Whitespace,
                TokenKind::Ident, // Name
                TokenKind::Whitespace,
                TokenKind::Keyword, // FROM
                TokenKind::Whitespace,
                TokenKind::Ident, // Account
            ]
        );
        assert_eq!(toks[0].text, "SELECT");
        assert_eq!(toks[7].text, "FROM");

        let account = toks.last().unwrap();
        assert_eq!(account.text, "Account");
        assert_eq!(&input[account.start..account.end], "Account");
    }
}
