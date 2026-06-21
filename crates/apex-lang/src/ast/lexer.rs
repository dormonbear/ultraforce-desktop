//! AST-grade Apex lexer: a complete token stream for the typed-AST parser.
//!
//! Independent of the heuristic `crate::lexer` (which the shipping completion
//! engine still uses). Tokens carry only a kind + byte span; text is recovered
//! via [`Token::text`]. Never panics — unterminated strings/comments lex to EOF.

/// A lexical token kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tok {
    Ident,
    Keyword,
    IntLit,
    LongLit,
    DecimalLit,
    StringLit,
    BoolLit,
    NullLit,
    // Punctuation.
    Dot,
    Comma,
    Semi,
    Colon,
    Question,
    At,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    // Operators.
    Assign,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    PlusEq,
    MinusEq,
    StarEq,
    SlashEq,
    Inc,
    Dec,
    AndAnd,
    OrOr,
    Bang,
    Amp,
    Pipe,
    Caret,
    FatArrow,
    // Trivia.
    LineComment,
    BlockComment,
    Whitespace,
    Unknown,
}

/// A token: its kind and byte span into the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Token {
    pub kind: Tok,
    pub start: usize,
    pub end: usize,
}

impl Token {
    /// The source text this token spans.
    pub fn text<'a>(&self, src: &'a str) -> &'a str {
        &src[self.start..self.end]
    }
}

/// Reserved Apex keywords (case-insensitive). `true`/`false`/`null` are lexed as
/// literals, not keywords. Contextual words (`get`, `set`, `sharing`, `when`, …)
/// stay identifiers; the parser recognizes them by text.
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
            | "finally"
            | "for"
            | "global"
            | "if"
            | "implements"
            | "instanceof"
            | "interface"
            | "new"
            | "override"
            | "private"
            | "protected"
            | "public"
            | "return"
            | "static"
            | "super"
            | "switch"
            | "this"
            | "throw"
            | "transient"
            | "trigger"
            | "try"
            | "virtual"
            | "void"
            | "webservice"
            | "while"
    )
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_continue(b: u8) -> bool {
    is_ident_start(b) || b.is_ascii_digit()
}

/// Lex `src` into tokens, including trivia (whitespace/comments).
pub fn lex(src: &str) -> Vec<Token> {
    let b = src.as_bytes();
    let n = b.len();
    let mut toks = Vec::new();
    let mut i = 0;

    // Push a token spanning [start, end) and advance.
    macro_rules! push {
        ($kind:expr, $start:expr, $end:expr) => {{
            toks.push(Token {
                kind: $kind,
                start: $start,
                end: $end,
            });
        }};
    }

    while i < n {
        let start = i;
        let c = b[i];

        // Whitespace run.
        if c.is_ascii_whitespace() {
            i += 1;
            while i < n && b[i].is_ascii_whitespace() {
                i += 1;
            }
            push!(Tok::Whitespace, start, i);
            continue;
        }

        // Comments (must precede the `/` operator).
        if c == b'/' && i + 1 < n && b[i + 1] == b'/' {
            i += 2;
            while i < n && b[i] != b'\n' {
                i += 1;
            }
            push!(Tok::LineComment, start, i);
            continue;
        }
        if c == b'/' && i + 1 < n && b[i + 1] == b'*' {
            i += 2;
            while i < n && !(b[i] == b'*' && i + 1 < n && b[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n); // consume the closing */ (or clamp at EOF)
            push!(Tok::BlockComment, start, i);
            continue;
        }

        // String literal with `\` escapes; unterminated → to EOF.
        if c == b'\'' {
            i += 1;
            while i < n {
                if b[i] == b'\\' {
                    i = (i + 2).min(n);
                    continue;
                }
                if b[i] == b'\'' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            push!(Tok::StringLit, start, i);
            continue;
        }

        // Number: digits, optional `.digits` (decimal), optional `L` (long).
        if c.is_ascii_digit() {
            i += 1;
            while i < n && b[i].is_ascii_digit() {
                i += 1;
            }
            let mut kind = Tok::IntLit;
            if i + 1 < n && b[i] == b'.' && b[i + 1].is_ascii_digit() {
                i += 1;
                while i < n && b[i].is_ascii_digit() {
                    i += 1;
                }
                kind = Tok::DecimalLit;
            }
            if kind == Tok::IntLit && i < n && (b[i] == b'L' || b[i] == b'l') {
                i += 1;
                kind = Tok::LongLit;
            }
            push!(kind, start, i);
            continue;
        }

        // Identifier / keyword / boolean / null literal.
        if is_ident_start(c) {
            i += 1;
            while i < n && is_ident_continue(b[i]) {
                i += 1;
            }
            let word = &src[start..i];
            let lower = word.to_ascii_lowercase();
            let kind = match lower.as_str() {
                "true" | "false" => Tok::BoolLit,
                "null" => Tok::NullLit,
                _ if is_keyword(word) => Tok::Keyword,
                _ => Tok::Ident,
            };
            push!(kind, start, i);
            continue;
        }

        // Operators & punctuation. Two-char forms first.
        let c2 = if i + 1 < n { b[i + 1] } else { 0 };
        let (kind, len) = match (c, c2) {
            (b'=', b'=') => (Tok::Eq, 2),
            (b'=', b'>') => (Tok::FatArrow, 2),
            (b'!', b'=') => (Tok::Ne, 2),
            (b'<', b'=') => (Tok::Le, 2),
            (b'>', b'=') => (Tok::Ge, 2),
            (b'&', b'&') => (Tok::AndAnd, 2),
            (b'|', b'|') => (Tok::OrOr, 2),
            (b'+', b'+') => (Tok::Inc, 2),
            (b'-', b'-') => (Tok::Dec, 2),
            (b'+', b'=') => (Tok::PlusEq, 2),
            (b'-', b'=') => (Tok::MinusEq, 2),
            (b'*', b'=') => (Tok::StarEq, 2),
            (b'/', b'=') => (Tok::SlashEq, 2),
            (b'=', _) => (Tok::Assign, 1),
            (b'!', _) => (Tok::Bang, 1),
            (b'<', _) => (Tok::Lt, 1),
            (b'>', _) => (Tok::Gt, 1),
            (b'&', _) => (Tok::Amp, 1),
            (b'|', _) => (Tok::Pipe, 1),
            (b'+', _) => (Tok::Plus, 1),
            (b'-', _) => (Tok::Minus, 1),
            (b'*', _) => (Tok::Star, 1),
            (b'/', _) => (Tok::Slash, 1),
            (b'%', _) => (Tok::Percent, 1),
            (b'^', _) => (Tok::Caret, 1),
            (b'.', _) => (Tok::Dot, 1),
            (b',', _) => (Tok::Comma, 1),
            (b';', _) => (Tok::Semi, 1),
            (b':', _) => (Tok::Colon, 1),
            (b'?', _) => (Tok::Question, 1),
            (b'@', _) => (Tok::At, 1),
            (b'(', _) => (Tok::LParen, 1),
            (b')', _) => (Tok::RParen, 1),
            (b'{', _) => (Tok::LBrace, 1),
            (b'}', _) => (Tok::RBrace, 1),
            (b'[', _) => (Tok::LBracket, 1),
            (b']', _) => (Tok::RBracket, 1),
            _ => (Tok::Unknown, 1),
        };
        i += len;
        push!(kind, start, i);
    }

    toks
}

/// Tokens with trivia (whitespace + comments) removed — what the parser consumes.
pub fn lex_code(src: &str) -> Vec<Token> {
    lex(src)
        .into_iter()
        .filter(|t| {
            !matches!(
                t.kind,
                Tok::Whitespace | Tok::LineComment | Tok::BlockComment
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<Tok> {
        lex_code(src).into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn lexes_operators_and_punctuation() {
        assert_eq!(
            kinds("a == b != c <= d >= e && f || g => h"),
            vec![
                Tok::Ident,
                Tok::Eq,
                Tok::Ident,
                Tok::Ne,
                Tok::Ident,
                Tok::Le,
                Tok::Ident,
                Tok::Ge,
                Tok::Ident,
                Tok::AndAnd,
                Tok::Ident,
                Tok::OrOr,
                Tok::Ident,
                Tok::FatArrow,
                Tok::Ident,
            ]
        );
    }

    #[test]
    fn lexes_compound_assign_and_incdec() {
        assert_eq!(
            kinds("x += 1; y++; z--; w *= 2"),
            vec![
                Tok::Ident,
                Tok::PlusEq,
                Tok::IntLit,
                Tok::Semi,
                Tok::Ident,
                Tok::Inc,
                Tok::Semi,
                Tok::Ident,
                Tok::Dec,
                Tok::Semi,
                Tok::Ident,
                Tok::StarEq,
                Tok::IntLit,
            ]
        );
    }

    #[test]
    fn generic_close_is_two_gt() {
        // List<List<Id>> → the trailing >> must be two Gt tokens.
        let k = kinds("List<List<Id>>");
        assert_eq!(k.iter().filter(|&&t| t == Tok::Gt).count(), 2);
        assert_eq!(k.iter().filter(|&&t| t == Tok::Lt).count(), 2);
    }

    #[test]
    fn lexes_brackets_colon_question_at() {
        assert_eq!(
            kinds("@IsTest a[0] ? b : c"),
            vec![
                Tok::At,
                Tok::Ident,
                Tok::Ident,
                Tok::LBracket,
                Tok::IntLit,
                Tok::RBracket,
                Tok::Question,
                Tok::Ident,
                Tok::Colon,
                Tok::Ident,
            ]
        );
    }

    #[test]
    fn lexes_number_literals() {
        assert_eq!(
            kinds("1 2L 3.14"),
            vec![Tok::IntLit, Tok::LongLit, Tok::DecimalLit]
        );
    }

    #[test]
    fn dot_after_integer_is_member_access_not_decimal() {
        // `5.toString()` — the `.` is member access, not a decimal point.
        assert_eq!(
            kinds("5.toString()"),
            vec![Tok::IntLit, Tok::Dot, Tok::Ident, Tok::LParen, Tok::RParen]
        );
    }

    #[test]
    fn lexes_bool_null_literals() {
        assert_eq!(
            kinds("true false null"),
            vec![Tok::BoolLit, Tok::BoolLit, Tok::NullLit]
        );
    }

    #[test]
    fn keywords_case_insensitive() {
        assert_eq!(
            kinds("Public CLASS Foo"),
            vec![Tok::Keyword, Tok::Keyword, Tok::Ident]
        );
    }

    #[test]
    fn string_with_escaped_quote() {
        let toks = lex_code("'it\\'s'");
        assert_eq!(toks.len(), 1);
        assert_eq!(toks[0].kind, Tok::StringLit);
        assert_eq!(toks[0].text("'it\\'s'"), "'it\\'s'");
    }

    #[test]
    fn comments_are_trivia() {
        let src = "a // line\n/* block */ b";
        assert_eq!(kinds(src), vec![Tok::Ident, Tok::Ident]);
        // But lex() keeps them.
        let all: Vec<Tok> = lex(src).into_iter().map(|t| t.kind).collect();
        assert!(all.contains(&Tok::LineComment));
        assert!(all.contains(&Tok::BlockComment));
    }

    #[test]
    fn unterminated_string_and_block_comment_recover() {
        assert_eq!(lex("'oops").last().unwrap().kind, Tok::StringLit);
        assert_eq!(lex("/* oops").last().unwrap().kind, Tok::BlockComment);
    }

    #[test]
    fn spans_are_correct() {
        let src = "Integer x = 1;";
        let toks = lex_code(src);
        assert_eq!(toks[0].text(src), "Integer");
        assert_eq!(toks[1].text(src), "x");
        assert_eq!(toks[2].text(src), "=");
        assert_eq!(toks[3].text(src), "1");
        assert_eq!(toks[4].text(src), ";");
    }
}
