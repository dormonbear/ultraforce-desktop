//! Inline SOQL/SOSL literal detection in Apex source (`[SELECT …]`).
//! Pure byte scanning — independent of any parser stack.

/// If `cursor` sits inside an inline SOQL literal `[SELECT …]`, return the byte range of the inner
/// SOQL text (brackets excluded). `None` for array indexing (`arr[0]`) or outside any bracket.
/// Tolerates an unclosed bracket (region ends at EOF) for live typing.
pub fn soql_region_at(input: &str, cursor: usize) -> Option<(usize, usize)> {
    let cursor = cursor.min(input.len());
    let bytes = input.as_bytes();

    // Nearest enclosing '[' to the left (skip balanced ']' … '[').
    let mut depth = 0i32;
    let mut open = None;
    let mut i = cursor;
    while i > 0 {
        i -= 1;
        match bytes[i] {
            b']' => depth += 1,
            b'[' => {
                if depth == 0 {
                    open = Some(i);
                    break;
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    let open = open?;

    // Matching ']' at/after the open (EOF if unclosed).
    let mut depth = 0i32;
    let mut close = input.len();
    let mut j = open + 1;
    while j < input.len() {
        match bytes[j] {
            b'[' => depth += 1,
            b']' => {
                if depth == 0 {
                    close = j;
                    break;
                }
                depth -= 1;
            }
            _ => {}
        }
        j += 1;
    }

    // Array/list indexing (`arr[0]`, `getList()[i]`, `new Account[]`) is NOT
    // SOQL. Apex has no bracket collection literal, so a '[' opens SOQL/SOSL
    // unless it indexes a value — i.e. the preceding token is a plain
    // identifier, ')' or ']'. A leading DML/return keyword (`delete [...]`) or
    // an operator/paren (`= [...]`, `query([...])`) means SOQL.
    if !precedes_inline_soql(&input[..open]) {
        return None;
    }

    let inner = &input[open + 1..close];
    // The leading keyword may be partial while typing (e.g. "SELE") or absent
    // (cursor right after '['). Accept an empty or SELECT/FIND-prefix word.
    let lead: String = inner
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_uppercase();
    let is_soql = lead.is_empty()
        || "SELECT".starts_with(&lead)
        || lead.starts_with("SELECT")
        || "FIND".starts_with(&lead)
        || lead.starts_with("FIND");
    if is_soql {
        Some((open + 1, close))
    } else {
        None
    }
}

/// Whether a '[' following `before` opens an inline SOQL/SOSL query rather than
/// indexing a value.
fn precedes_inline_soql(before: &str) -> bool {
    let trimmed = before.trim_end();
    match trimmed.chars().next_back() {
        None => true,
        Some(')') | Some(']') => false,
        Some(c) if c.is_alphanumeric() || c == '_' => {
            let word: String = trimmed
                .chars()
                .rev()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            matches!(
                word.to_ascii_lowercase().as_str(),
                "return" | "delete" | "insert" | "update" | "upsert" | "undelete" | "merge"
            )
        }
        Some(_) => true,
    }
}

/// All inline SOQL literal inner ranges `[SELECT …]` in `input` (brackets excluded), left→right.
/// Skips non-SELECT brackets (e.g. array indexing). Bracket bytes are ASCII so byte indexing is safe.
pub fn soql_regions(input: &str) -> Vec<(usize, usize)> {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < input.len() {
        if bytes[i] != b'[' {
            i += 1;
            continue;
        }
        // matching ']' (depth-aware), EOF if unclosed
        let mut depth = 0i32;
        let mut close = input.len();
        let mut j = i + 1;
        while j < input.len() {
            match bytes[j] {
                b'[' => depth += 1,
                b']' => {
                    if depth == 0 {
                        close = j;
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
            j += 1;
        }
        let inner = &input[i + 1..close];
        if inner
            .trim_start()
            .get(..6)
            .is_some_and(|s| s.eq_ignore_ascii_case("select"))
        {
            out.push((i + 1, close));
        }
        i = close + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soql_region_detection() {
        // cursor inside a SOQL literal -> inner range (excludes brackets)
        let s = "Account a = [SELECT Na FROM Account];";
        let cur = s.find("Na").unwrap() + 2;
        let (start, end) = soql_region_at(s, cur).expect("in soql");
        assert_eq!(&s[start..end], "SELECT Na FROM Account");

        // array indexing is NOT soql
        assert!(soql_region_at("x = arr[0];", "x = arr[0".len()).is_none());

        // outside any bracket
        assert!(soql_region_at("Integer x = 1;", 5).is_none());

        // unclosed bracket while typing -> region runs to EOF
        let u = "List<Account> l = [SELECT Id FROM Acc";
        assert!(soql_region_at(u, u.len()).is_some());

        // partial leading keyword while typing "SELECT" -> still a SOQL region
        let p = "List<Account> l = [\n    SELE\n]";
        let cur = p.find("SELE").unwrap() + 4;
        assert!(soql_region_at(p, cur).is_some());

        // bare '[' at an expression start (cursor right after it) -> SOQL
        let b = "List<Account> l = [";
        assert!(soql_region_at(b, b.len()).is_some());

        // DML keyword before the bracket -> SOQL, not indexing
        let d = "delete [SELECT Id FROM Account];";
        assert!(soql_region_at(d, d.find("SELECT").unwrap() + 2).is_some());

        // index var whose name is a SELECT/FIND prefix is NOT soql (preceded by
        // a plain identifier, so it indexes a value)
        assert!(soql_region_at("x = arr[s];", "x = arr[s".len()).is_none());
        assert!(soql_region_at("x = getList()[0];", "x = getList()[0".len()).is_none());
    }

    #[test]
    fn soql_regions_finds_all_select_literals() {
        let src = "List<Account> a = [SELECT Id FROM Account]; Integer n = arr[0]; Account b = [SELECT Bogus FROM Account];";
        let r = soql_regions(src);
        assert_eq!(r.len(), 2);
        assert_eq!(&src[r[0].0..r[0].1], "SELECT Id FROM Account");
        assert_eq!(&src[r[1].0..r[1].1], "SELECT Bogus FROM Account");
        // a non-SELECT bracket (array index) is not a region
        assert!(soql_regions("x = arr[0];").is_empty());
    }
}
