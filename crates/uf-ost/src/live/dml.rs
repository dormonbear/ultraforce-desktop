//! Single-record CRUD over REST, behind the prod confirm gate.

use rmcp::{schemars, ErrorData};
use serde::Serialize;

use crate::live::{gate_write, LiveCtx};

#[derive(Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationDto {
    pub org: String,
    pub object: String,
    pub id: String,
    pub action: String, // "created" | "updated" | "deleted"
}

pub fn validate_fields(fields: &serde_json::Value) -> Result<(), ErrorData> {
    if !fields.is_object() {
        return Err(ErrorData::invalid_params(
            "`fields` must be a JSON object of {FieldApiName: value}".to_string(),
            None,
        ));
    }
    Ok(())
}

pub async fn get(
    live: &LiveCtx,
    org: &str,
    object: &str,
    id: &str,
) -> Result<serde_json::Value, ErrorData> {
    let auth = live.auth(org).await?;
    features::rest_dml::record_get(&auth, object, id)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))
}

pub async fn create(
    live: &LiveCtx,
    org: &str,
    object: &str,
    fields: &serde_json::Value,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    validate_fields(fields)?;
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    let id = features::rest_dml::record_create(&auth, object, fields)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto {
        org: org.into(),
        object: object.into(),
        id,
        action: "created".into(),
    })
}

pub async fn update(
    live: &LiveCtx,
    org: &str,
    object: &str,
    id: &str,
    fields: &serde_json::Value,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    validate_fields(fields)?;
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    features::rest_dml::record_update(&auth, object, id, fields)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto {
        org: org.into(),
        object: object.into(),
        id: id.into(),
        action: "updated".into(),
    })
}

pub async fn delete(
    live: &LiveCtx,
    org: &str,
    object: &str,
    id: &str,
    confirm: bool,
) -> Result<MutationDto, ErrorData> {
    gate_write(live.is_prod(org).await, confirm)?;
    let auth = live.auth(org).await?;
    features::rest_dml::record_delete(&auth, object, id)
        .await
        .map_err(|e| ErrorData::invalid_params(e.to_string(), None))?;
    Ok(MutationDto {
        org: org.into(),
        object: object.into(),
        id: id.into(),
        action: "deleted".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_must_be_json_object() {
        let bad = serde_json::json!([1, 2]);
        assert!(validate_fields(&bad).is_err());
        let good = serde_json::json!({"Name": "Acme"});
        assert!(validate_fields(&good).is_ok());
    }
}
