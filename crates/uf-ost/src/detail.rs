//! Heavy field detail that `ost_object` deliberately keeps out of its compact
//! table: formula bodies, decoded picklist-dependency maps, and the extra field
//! attributes — plus record-type identity. Batch (many fields per call).

use sf_schema::model::{Field, SObjectSchema};
use sf_schema::sqlite;

use crate::query::{QueryError, Snapshot};

/// Full detail for each requested field of `object` (batch). Unknown names are
/// reported inline rather than erroring the whole call.
pub fn fields(snap: &Snapshot, object: &str, names: &[String]) -> Result<String, QueryError> {
    let schema = read(snap, object)?;
    let stamp = snap.stamp();
    let mut out = format!("{}  org={}  age={}\n", schema.name, stamp.org, stamp.age);
    if names.is_empty() {
        out.push_str("(pass one or more field names)\n");
        return Ok(out);
    }
    for name in names {
        match schema.fields.iter().find(|f| f.name.eq_ignore_ascii_case(name)) {
            Some(f) => out.push_str(&render_field(&schema, f)),
            None => out.push_str(&format!("{name}: not found\n")),
        }
    }
    Ok(out)
}

/// Record-type identities of `object`.
pub fn record_types(snap: &Snapshot, object: &str) -> Result<String, QueryError> {
    let schema = read(snap, object)?;
    let stamp = snap.stamp();
    let mut out = format!(
        "{}  org={}  age={}  recordTypes={}\n",
        schema.name,
        stamp.org,
        stamp.age,
        schema.record_type_infos.len()
    );
    for rt in &schema.record_type_infos {
        let flags: Vec<&str> = [
            rt.active.then_some("active"),
            rt.master.then_some("master"),
            (!rt.available).then_some("unavailable"),
        ]
        .into_iter()
        .flatten()
        .collect();
        out.push_str(&format!(
            "{}  id={}  {}\n",
            rt.developer_name,
            rt.record_type_id.as_deref().unwrap_or("-"),
            flags.join(",")
        ));
    }
    Ok(out)
}

fn read(snap: &Snapshot, object: &str) -> Result<SObjectSchema, QueryError> {
    sqlite::read_object(snap.conn(), object)?
        .ok_or_else(|| QueryError::NotFound(format!("object '{object}' not in index")))
}

fn render_field(schema: &SObjectSchema, f: &Field) -> String {
    let mut attrs: Vec<String> = Vec::new();
    if f.length > 0 {
        attrs.push(format!("length={}", f.length));
    }
    if f.unique {
        attrs.push("unique".into());
    }
    if f.restricted_picklist {
        attrs.push("restricted".into());
    }
    if !f.reference_to.is_empty() {
        let rel = f
            .relationship_name
            .as_deref()
            .map(|r| format!(" [{r}]"))
            .unwrap_or_default();
        attrs.push(format!("→{}{}", f.reference_to.join(","), rel));
    }
    let tail = if attrs.is_empty() {
        String::new()
    } else {
        format!("  {}", attrs.join("  "))
    };
    let mut s = format!("{}  {}{}\n", f.name, f.field_type, tail);

    if f.calculated {
        if let Some(formula) = &f.calculated_formula {
            s.push_str(&format!("  formula = {formula}\n"));
        }
    }
    if let Some(dv) = &f.default_value_formula {
        s.push_str(&format!("  default = {dv}\n"));
    }
    // Dependent picklist: decode each active value's validFor against the
    // controlling field's ordered active values.
    if f.dependent_picklist {
        if let Some(cname) = &f.controller_name {
            s.push_str(&format!("  dependent on {cname}:\n"));
            let ctrl_vals = active_values(schema, cname);
            for v in f.picklist_values.iter().filter(|v| v.active) {
                if let Some(vf) = &v.valid_for {
                    let allowed = valid_controllers(vf, &ctrl_vals);
                    s.push_str(&format!("    {} ⇐ {{{}}}\n", v.value, allowed.join(", ")));
                }
            }
        }
    }
    s
}

/// Active picklist values of `field` on `schema`, in order (empty if absent).
fn active_values(schema: &SObjectSchema, field: &str) -> Vec<String> {
    schema
        .fields
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case(field))
        .map(|f| {
            f.picklist_values
                .iter()
                .filter(|v| v.active)
                .map(|v| v.value.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Controlling values a dependent value is available for: bit `i` of the
/// base64 `valid_for` bitmap ⇒ `controller_values[i]` is valid.
fn valid_controllers(valid_for: &str, controller_values: &[String]) -> Vec<String> {
    let bytes = b64_decode(valid_for);
    controller_values
        .iter()
        .enumerate()
        .filter(|(i, _)| bytes.get(i >> 3).is_some_and(|b| b & (0x80 >> (i & 7)) != 0))
        .map(|(_, v)| v.clone())
        .collect()
}

/// Minimal standard-alphabet base64 decode (skips `=` padding / whitespace).
fn b64_decode(s: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        let Some(v) = val(c) else { continue };
        buf = (buf << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_and_bitmap_decode_a_dependency() {
        // "gAAA" = bytes [0x80, 0, 0] → only controller index 0 is valid.
        assert_eq!(b64_decode("gAAA"), vec![0x80, 0x00, 0x00]);
        let ctrl = vec!["Tech".to_string(), "Retail".to_string(), "Gov".to_string()];
        assert_eq!(valid_controllers("gAAA", &ctrl), vec!["Tech".to_string()]);
        // "wAAA" = 0xC0 → indexes 0 and 1.
        assert_eq!(
            valid_controllers("wAAA", &ctrl),
            vec!["Tech".to_string(), "Retail".to_string()]
        );
    }

    #[test]
    fn render_field_shows_formula_and_dependency() {
        let controller = Field {
            name: "Industry".into(),
            field_type: "picklist".into(),
            picklist_values: vec![
                pick("Tech"),
                pick("Retail"),
            ],
            ..Default::default()
        };
        let dependent = Field {
            name: "SubType__c".into(),
            field_type: "picklist".into(),
            dependent_picklist: true,
            controller_name: Some("Industry".into()),
            picklist_values: vec![valid_pick("SaaS", "gAAA")], // valid for Tech only
            ..Default::default()
        };
        let formula = Field {
            name: "Score__c".into(),
            field_type: "double".into(),
            calculated: true,
            calculated_formula: Some("Amount * 2".into()),
            ..Default::default()
        };
        let schema = SObjectSchema {
            name: "Account".into(),
            fields: vec![controller, dependent.clone(), formula.clone()],
            ..Default::default()
        };

        let f = render_field(&schema, &formula);
        assert!(f.contains("formula = Amount * 2"), "{f}");

        let d = render_field(&schema, &dependent);
        assert!(
            d.contains("dependent on Industry") && d.contains("SaaS ⇐ {Tech}"),
            "{d}"
        );
    }

    fn pick(v: &str) -> sf_schema::model::PicklistValue {
        sf_schema::model::PicklistValue {
            value: v.into(),
            active: true,
            ..Default::default()
        }
    }

    fn valid_pick(v: &str, valid_for: &str) -> sf_schema::model::PicklistValue {
        sf_schema::model::PicklistValue {
            valid_for: Some(valid_for.into()),
            ..pick(v)
        }
    }
}
