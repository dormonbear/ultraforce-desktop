//! Offline SOQL validation against an org snapshot: unknown SELECT fields, bad
//! relationship names in dotted paths, and WHERE operator/type mistakes — each
//! unknown name gets a nearest-match suggestion. Compact text out, no rmcp here.

use std::collections::{HashMap, HashSet};

use sf_schema::{sqlite, SObjectSchema};
use soql_lang::{diagnostics, outline};

use crate::query::{QueryError, Snapshot};

/// Validate `query` against the snapshot's indexed schema.
///
/// Reuses `soql_lang::diagnostics` for flat-field + WHERE checks; relationship
/// existence is checked here because `diagnostics` stays silent on unresolved
/// relationships (a no-false-positive choice for the live editor, but this is a
/// validate-a-finished-query call where the bad relationship IS the answer).
pub fn soql_check(snap: &Snapshot, query: &str) -> Result<String, QueryError> {
    let stamp = snap.stamp();
    let head = |body: &str| format!("org={}  age={}\n{body}\n", stamp.org, stamp.age);

    let o = outline(query);
    let Some(from) = o.from_object.as_deref() else {
        return Ok(head("No FROM clause found."));
    };
    let Some(root) = sqlite::read_object(snap.conn(), from)? else {
        return Ok(head(&format!("Unknown object '{from}' — not in this index.")));
    };

    // Preload objects reachable via the relationship-name segments this query
    // actually references — bounded to the query, not the whole schema graph.
    let used: HashSet<String> = o
        .select_fields
        .iter()
        .filter(|f| f.name.contains('.'))
        .flat_map(|f| {
            let segs: Vec<&str> = f.name.split('.').collect();
            segs[..segs.len() - 1]
                .iter()
                .map(|s| s.to_ascii_lowercase())
                .collect::<Vec<_>>()
        })
        .collect();

    let mut map: HashMap<String, SObjectSchema> = HashMap::new();
    let from_key = root.name.clone();
    map.insert(from_key.clone(), root);
    let mut frontier = vec![from_key.clone()];
    while let Some(obj) = frontier.pop() {
        let targets: Vec<String> = map[&obj]
            .fields
            .iter()
            .filter(|f| {
                f.relationship_name
                    .as_deref()
                    .is_some_and(|r| used.contains(&r.to_ascii_lowercase()))
            })
            .flat_map(|f| f.reference_to.iter().cloned())
            .collect();
        for t in targets {
            if !map.contains_key(&t) {
                if let Some(s) = sqlite::read_object(snap.conn(), &t)? {
                    let key = s.name.clone();
                    map.insert(key.clone(), s);
                    frontier.push(key);
                }
            }
        }
    }

    let root = &map[&from_key];
    let resolve = |name: &str| map.get(name);

    let mut diags: Vec<(usize, String)> = Vec::new();
    for f in &o.select_fields {
        if f.name == "*" {
            continue;
        }
        if let Some(msg) = check_select(root, &resolve, &f.name) {
            diags.push((f.start, msg));
        }
    }
    // WHERE operator/type checks only — our own pass owns field/relationship
    // errors (with suggestions), so drop `diagnostics`' "Unknown field" lines.
    for d in diagnostics(query, root, &resolve) {
        if !d.message.starts_with("Unknown field") {
            diags.push((d.start, d.message));
        }
    }
    diags.sort_by_key(|(pos, _)| *pos);

    if diags.is_empty() {
        return Ok(head(&format!(
            "OK — {} SELECT field(s) resolve against {}.",
            o.select_fields.len(),
            root.name
        )));
    }
    let body: String = diags
        .iter()
        .map(|(pos, msg)| format!("ERROR col {pos}: {msg}"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(head(&body))
}

/// Validate one (possibly dotted) SELECT path, mirroring `soql_lang`'s
/// polymorphic resolution but reporting the failing hop with a suggestion.
fn check_select<'a>(
    root: &'a SObjectSchema,
    resolve: &dyn Fn(&str) -> Option<&'a SObjectSchema>,
    path: &str,
) -> Option<String> {
    let segs: Vec<&str> = path.split('.').collect();
    if segs.len() == 1 {
        return match root.field(path) {
            Some(_) => None,
            None => Some(unknown("field", path, &root.name, &field_names(root))),
        };
    }
    // Intermediate relationships resolve through their first target.
    let mut cur = root;
    for seg in &segs[..segs.len() - 2] {
        let Some(rel) = find_rel(cur, seg) else {
            return Some(unknown("relationship", seg, &cur.name, &rel_names(cur)));
        };
        match rel.reference_to.first().and_then(|t| resolve(t)) {
            Some(next) => cur = next,
            None => return None, // target not indexed — don't false-flag
        }
    }
    let last_rel = segs[segs.len() - 2];
    let field = segs[segs.len() - 1];
    let Some(rel) = find_rel(cur, last_rel) else {
        return Some(unknown("relationship", last_rel, &cur.name, &rel_names(cur)));
    };
    // Polymorphic: the field is valid if it lives on ANY target of the last hop.
    let targets: Vec<&SObjectSchema> = rel.reference_to.iter().filter_map(|t| resolve(t)).collect();
    if targets.is_empty() || targets.iter().any(|s| s.field(field).is_some()) {
        return None;
    }
    let cands: Vec<String> = targets.iter().flat_map(|s| field_names(s)).collect();
    Some(unknown("field", field, &targets[0].name, &cands))
}

fn find_rel<'a>(schema: &'a SObjectSchema, rel: &str) -> Option<&'a sf_schema::model::Field> {
    schema.fields.iter().find(|f| {
        f.relationship_name
            .as_deref()
            .is_some_and(|r| r.eq_ignore_ascii_case(rel))
    })
}

fn field_names(s: &SObjectSchema) -> Vec<String> {
    s.fields.iter().map(|f| f.name.clone()).collect()
}

fn rel_names(s: &SObjectSchema) -> Vec<String> {
    s.fields
        .iter()
        .filter_map(|f| f.relationship_name.clone())
        .collect()
}

fn unknown(kind: &str, name: &str, obj: &str, candidates: &[String]) -> String {
    let mut msg = format!("Unknown {kind} '{name}' on {obj}");
    if let Some(s) = nearest(candidates, name) {
        msg.push_str(&format!(" — did you mean '{s}'?"));
    }
    msg
}

/// Nearest candidate to `token` by case-insensitive edit distance, within a
/// small threshold. `None` when nothing is close enough (no noisy guesses).
fn nearest(candidates: &[String], token: &str) -> Option<String> {
    let t = token.to_ascii_lowercase();
    let thresh = (t.len() / 3).max(2);
    candidates
        .iter()
        .map(|c| (levenshtein(&t, &c.to_ascii_lowercase()), c))
        .filter(|(d, _)| *d <= thresh)
        .min_by_key(|(d, _)| *d)
        .map(|(_, c)| c.clone())
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(name: &str, ty: &str) -> sf_schema::model::Field {
        sf_schema::model::Field {
            name: name.into(),
            field_type: ty.into(),
            nillable: true,
            ..Default::default()
        }
    }

    fn lookup(name: &str, rel: &str, target: &str) -> sf_schema::model::Field {
        sf_schema::model::Field {
            reference_to: vec![target.into()],
            relationship_name: Some(rel.into()),
            ..field(name, "reference")
        }
    }

    #[test]
    fn check_select_flags_fields_and_relationships_with_suggestions() {
        let user = SObjectSchema {
            name: "User".into(),
            fields: vec![field("Email", "email")],
            ..Default::default()
        };
        let account = SObjectSchema {
            name: "Account".into(),
            fields: vec![field("Name", "string"), lookup("OwnerId", "Owner", "User")],
            ..Default::default()
        };
        let mut map = HashMap::new();
        map.insert("User".to_string(), user);
        map.insert("Account".to_string(), account);
        let resolve = |n: &str| map.get(n);
        let root = &map["Account"];

        assert!(check_select(root, &resolve, "Name").is_none());
        assert!(check_select(root, &resolve, "Owner.Email").is_none());

        let f = check_select(root, &resolve, "Naem").unwrap();
        assert!(
            f.contains("Unknown field 'Naem'") && f.contains("did you mean 'Name'"),
            "{f}"
        );
        let r = check_select(root, &resolve, "Ownr.Email").unwrap();
        assert!(
            r.contains("Unknown relationship 'Ownr'") && r.contains("did you mean 'Owner'"),
            "{r}"
        );
        let ff = check_select(root, &resolve, "Owner.Emial").unwrap();
        assert!(
            ff.contains("Unknown field 'Emial'") && ff.contains("Email"),
            "{ff}"
        );
    }
}
