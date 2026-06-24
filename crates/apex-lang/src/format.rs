//! Tier 0 Apex formatter: re-indent by brace depth, preserving everything else.
//!
//! Scope (deliberately minimal — see `apex-formatter-spec.md`):
//! - Re-indent each line to its `{}` nesting depth (4 spaces / level).
//! - Lines inside an unbalanced `(`/`[` (wrapped expressions, multi-line SOQL)
//!   keep the author's original indentation — never re-flowed.
//! - Comments and string literals are emitted verbatim; their interior is never
//!   touched (brace/quote chars inside them are part of a single token, so they
//!   never affect depth).
//! - Author line breaks are kept; runs of blank lines are clamped to 2.
//!
//! NOT in scope yet: intra-line spacing normalization, K&R brace forcing,
//! keyword casing, SOQL clause breaking — those need the AST (unary vs binary,
//! generics vs comparison) and are later tiers.
//!
//! Round-trip safe: if the rewrite would change the *code* token stream (a bug),
//! the original source is returned unchanged.

use crate::ast::lexer::{lex, lex_code, Tok};

const INDENT: &str = "    ";

/// Re-indent Apex source by brace depth. Returns the input unchanged if the
/// result would not round-trip to the same code tokens.
pub fn format_apex(src: &str) -> String {
    let toks = lex(src);
    let mut out = String::with_capacity(src.len() + 16);
    let mut brace: i32 = 0;
    let mut paren_bracket: i32 = 0;
    // The file starts at the beginning of a line.
    let mut pending_indent = true;
    let mut orig_indent = String::new();

    for t in &toks {
        if t.kind == Tok::Whitespace {
            let text = t.text(src);
            if let Some(pos) = text.rfind('\n') {
                // A line break: emit the newlines (blank lines capped at 2),
                // drop trailing spaces, and remember this line's indentation in
                // case we're inside parens and must preserve it.
                let nls = text[..=pos].matches('\n').count().min(3);
                for _ in 0..nls {
                    out.push('\n');
                }
                orig_indent = text[pos + 1..].to_string();
                pending_indent = true;
            } else if !pending_indent {
                // Intra-line spacing: kept verbatim. Leading whitespace of the
                // first line (pending_indent still set) is dropped.
                out.push_str(text);
            }
            continue;
        }

        // A real token. Closing braces dedent the line they start.
        if t.kind == Tok::RBrace {
            brace -= 1;
        }

        if pending_indent {
            if paren_bracket > 0 {
                out.push_str(&orig_indent);
            } else {
                for _ in 0..brace.max(0) {
                    out.push_str(INDENT);
                }
            }
            pending_indent = false;
        }
        out.push_str(t.text(src));

        match t.kind {
            Tok::LBrace => brace += 1,
            Tok::LParen | Tok::LBracket => paren_bracket += 1,
            Tok::RParen | Tok::RBracket => paren_bracket -= 1,
            _ => {}
        }
    }

    let formatted = out.trim_end().to_string();
    if same_code_tokens(src, &formatted) {
        formatted
    } else {
        src.to_string()
    }
}

/// True if `a` and `b` lex to the same non-trivia token stream.
fn same_code_tokens(a: &str, b: &str) -> bool {
    let ta = lex_code(a);
    let tb = lex_code(b);
    ta.len() == tb.len()
        && ta
            .iter()
            .zip(&tb)
            .all(|(x, y)| x.kind == y.kind && x.text(a) == y.text(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reindents_nested_blocks() {
        let src = "public class Foo {\nvoid bar() {\nif (x) {\nSystem.debug(1);\n}\n}\n}";
        assert_eq!(
            format_apex(src),
            "public class Foo {\n    void bar() {\n        if (x) {\n            System.debug(1);\n        }\n    }\n}"
        );
    }

    #[test]
    fn dedents_closing_brace_line() {
        let src = "if (x) {\n    foo();\n        }";
        assert_eq!(format_apex(src), "if (x) {\n    foo();\n}");
    }

    #[test]
    fn preserves_indentation_inside_parens() {
        // Wrapped argument list: author indentation kept as-is.
        let src = "foo(\n  a,\n  b\n);";
        assert_eq!(format_apex(src), "foo(\n  a,\n  b\n);");
    }

    #[test]
    fn braces_in_strings_do_not_affect_depth() {
        let src = "String s = '}{';\nfoo();";
        assert_eq!(format_apex(src), "String s = '}{';\nfoo();");
    }

    #[test]
    fn comments_reindented_but_text_intact() {
        let src = "if (x) {\n// note\nfoo();\n}";
        assert_eq!(
            format_apex(src),
            "if (x) {\n    // note\n    foo();\n}"
        );
    }

    #[test]
    fn block_comment_interior_untouched() {
        let src = "if (x) {\n/* a\n   b */\nfoo();\n}";
        assert_eq!(
            format_apex(src),
            "if (x) {\n    /* a\n   b */\n    foo();\n}"
        );
    }

    #[test]
    fn clamps_blank_lines_to_two() {
        let src = "foo();\n\n\n\n\nbar();";
        assert_eq!(format_apex(src), "foo();\n\n\nbar();");
    }

    #[test]
    fn is_idempotent() {
        let src = "class A {\nInteger x = 1;\nvoid m() {\nfor (Integer i = 0; i < 3; i++) {\nx++;\n}\n}\n}";
        let once = format_apex(src);
        assert_eq!(format_apex(&once), once);
    }
}
