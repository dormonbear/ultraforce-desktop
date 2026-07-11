//! Schema-browser orchestration: object list + detail + FTS search over the
//! per-org schema index. `lib.rs` holds only the thin command shells that
//! delegate here.

use apex_lang::db;
use sf_schema::model::{ChildRelationship, Field, PicklistValue, SObjectSchema};
use sf_schema::{sqlite, SchemaStore};

use crate::dto::{
    FieldDependenciesDto, FieldDependencyDto, SchemaChildRelationshipDto, SchemaFieldDto,
    SchemaObjectDetailDto, SchemaObjectDto, SchemaPicklistValueDto, SchemaRecordTypeDto,
    SchemaSearchHitDto,
};
use crate::error::CommandError;
use crate::state::AppState;

/// The index db is missing or stale (table absent) — tell the user to index.
fn no_index_err(org: &str) -> CommandError {
    CommandError::new(
        "no-index",
        format!("No schema index for org “{org}”. Index this org first."),
    )
}

fn picklist_dto(p: &PicklistValue) -> SchemaPicklistValueDto {
    SchemaPicklistValueDto {
        label: p.label.clone(),
        value: p.value.clone(),
        active: p.active,
        default_value: p.default_value,
    }
}

fn field_dto(f: &Field) -> SchemaFieldDto {
    SchemaFieldDto {
        name: f.name.clone(),
        label: f.label.clone(),
        field_type: f.field_type.clone(),
        custom: f.custom,
        nillable: f.nillable,
        reference_to: f.reference_to.clone(),
        relationship_name: f.relationship_name.clone(),
        picklist_values: f.picklist_values.iter().map(picklist_dto).collect(),
        restricted_picklist: f.restricted_picklist,
        dependent_picklist: f.dependent_picklist,
        calculated: f.calculated,
        calculated_formula: f.calculated_formula.clone(),
        length: f.length,
        unique: f.unique,
        inline_help_text: f.inline_help_text.clone(),
    }
}

fn child_dto(c: &ChildRelationship) -> SchemaChildRelationshipDto {
    SchemaChildRelationshipDto {
        child_s_object: c.child_sobject.clone(),
        relationship_name: c.relationship_name.clone(),
        field: c.field.clone(),
    }
}

/// Pure mapping: trimmed describe model → serde camelCase detail DTO.
pub fn object_detail_dto(s: &SObjectSchema) -> SchemaObjectDetailDto {
    SchemaObjectDetailDto {
        name: s.name.clone(),
        label: s.label.clone(),
        key_prefix: s.key_prefix.clone(),
        custom: s.custom,
        fields: s.fields.iter().map(field_dto).collect(),
        child_relationships: s.child_relationships.iter().map(child_dto).collect(),
        record_types: s
            .record_type_infos
            .iter()
            .map(|r| SchemaRecordTypeDto {
                name: r.name.clone(),
                developer_name: r.developer_name.clone(),
                active: r.active,
                master: r.master,
                available: r.available,
            })
            .collect(),
    }
}

/// Read the `objects` table for the browse list. Missing/stale index → `no-index`.
pub fn list_objects(org: &str, _state: &AppState) -> Result<Vec<SchemaObjectDto>, CommandError> {
    let path = sqlite::db_path(&SchemaStore::default_root(), org);
    // Reject a missing OR schema-version-mismatched index before reading rows,
    // so an upgrading user with a v2 index gets the "index this org" empty state
    // rather than stale rows (or a cryptic missing-column error).
    if !path.exists() || !db::index_matches_version(&path) {
        return Err(no_index_err(org));
    }
    let conn = sqlite::open_readonly(&path).map_err(|_| no_index_err(org))?;
    let rows = sqlite::list_objects(&conn).map_err(|_| no_index_err(org))?;
    Ok(rows
        .into_iter()
        .map(|(name, label, custom, key_prefix)| SchemaObjectDto {
            name,
            label,
            custom,
            key_prefix,
        })
        .collect())
}

/// Full detail for one object via the schema store (fetches on cache miss).
pub async fn object_detail(
    org: String,
    object: String,
    state: &AppState,
) -> Result<SchemaObjectDetailDto, CommandError> {
    // A stale-versioned index must never hand back v2-shaped disk rows: guard
    // BEFORE `get_or_fetch`, whose `load_disk` would otherwise SELECT columns
    // the old table lacks. A missing index falls through to a live describe.
    let root = SchemaStore::default_root();
    let path = sqlite::db_path(&root, &org);
    if path.exists() && !db::index_matches_version(&path) {
        return Err(no_index_err(&org));
    }
    let api = features::api_version::api_version_for(&state.invoker, &org).await;
    let mut store = SchemaStore::new(root, &org);
    let schema = store.get_or_fetch(&state.invoker, &api, &object).await?;
    Ok(object_detail_dto(&schema))
}

/// FTS search over the schema index. Missing/stale index → `no-index`.
pub fn search(
    org: &str,
    query: &str,
    limit: Option<u32>,
    _state: &AppState,
) -> Result<Vec<SchemaSearchHitDto>, CommandError> {
    let path = sqlite::db_path(&SchemaStore::default_root(), org);
    // Same stale/missing-index guard as `list_objects` before touching rows.
    if !path.exists() || !db::index_matches_version(&path) {
        return Err(no_index_err(org));
    }
    let conn = sqlite::open_readonly(&path).map_err(|_| no_index_err(org))?;
    let hits = sqlite::search_schema(&conn, query, limit.unwrap_or(30) as usize)
        .map_err(|_| no_index_err(org))?;
    Ok(hits
        .into_iter()
        .map(|h| SchemaSearchHitDto {
            object_name: h.object_name,
            field_name: h.field_name,
            field_label: h.field_label,
            snippet: h.snippet,
        })
        .collect())
}

// ---- Field where-used (MetadataComponentDependency + SQLite cache) --------

fn dep_dto(component_type: String, component_name: String, component_id: String) -> FieldDependencyDto {
    FieldDependencyDto {
        component_type,
        component_name,
        component_id,
    }
}

/// Current wall-clock time in epoch milliseconds (0 before the epoch).
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Pure cache decision: serve the where-used result from cache, or `None` to
/// signal a fresh fetch is required. A forced `refresh` or a cache miss both
/// return `None`; a hit (even zero deps) maps to a `supported` DTO.
fn cached_where_used(
    refresh: bool,
    cached: Option<(Vec<sqlite::FieldDep>, i64)>,
) -> Option<FieldDependenciesDto> {
    if refresh {
        return None;
    }
    let (deps, fetched_at) = cached?;
    Some(FieldDependenciesDto {
        supported: true,
        items: deps
            .into_iter()
            .map(|d| dep_dto(d.component_type, d.component_name, d.component_id))
            .collect(),
        fetched_at: Some(fetched_at),
    })
}

/// Map a cache (SQLite) error to a user-readable `CommandError` via `Display`
/// (no `Debug` leakage, no direct `rusqlite` dependency on this crate).
fn cache_err(e: impl std::fmt::Display) -> CommandError {
    CommandError::new("cache", format!("Field dependency cache error: {e}"))
}

/// Field "where-used": referencing components for `object.field`, cached in the
/// per-org `field_deps` table. Serves the cache unless `refresh`; on a miss (or
/// refresh) queries the org, caches a `Deps` result, and returns it. Standard
/// fields short-circuit to `supported: false` and are never cached.
pub async fn field_dependencies(
    org: String,
    object: String,
    field: String,
    refresh: bool,
    state: &AppState,
) -> Result<FieldDependenciesDto, CommandError> {
    // Writable open: creates the db + `field_deps` tables on first use, so a
    // never-indexed org can still cache where-used lookups.
    let path = sqlite::db_path(&SchemaStore::default_root(), &org);
    let conn = sqlite::open(&path).map_err(cache_err)?;

    if !refresh {
        let cached = sqlite::get_field_deps(&conn, &object, &field).map_err(cache_err)?;
        if let Some(dto) = cached_where_used(false, cached) {
            return Ok(dto);
        }
    }

    let auth = sf_core::OrgRegistry::auth_info(&state.invoker, Some(&org)).await?;
    match features::field_deps::fetch_field_dependencies(&auth, &object, &field).await? {
        features::field_deps::WhereUsed::Unsupported => Ok(FieldDependenciesDto {
            supported: false,
            items: vec![],
            fetched_at: None,
        }),
        features::field_deps::WhereUsed::Deps(deps) => {
            let fetched_at = now_ms();
            let rows: Vec<sqlite::FieldDep> = deps
                .iter()
                .map(|d| sqlite::FieldDep {
                    component_type: d.component_type.clone(),
                    component_name: d.component_name.clone(),
                    component_id: d.component_id.clone(),
                })
                .collect();
            sqlite::replace_field_deps(&conn, &object, &field, &rows, fetched_at)
                .map_err(cache_err)?;
            Ok(FieldDependenciesDto {
                supported: true,
                items: deps
                    .into_iter()
                    .map(|d| dep_dto(d.component_type, d.component_name, d.component_id))
                    .collect(),
                fetched_at: Some(fetched_at),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sf_schema::model::RecordTypeInfo;

    #[test]
    fn object_detail_dto_serializes_camel_case() {
        let schema = SObjectSchema {
            name: "Account".into(),
            label: "Account".into(),
            key_prefix: Some("001".into()),
            custom: false,
            fields: vec![Field {
                name: "Type".into(),
                label: "Account Type".into(),
                field_type: "picklist".into(),
                inline_help_text: Some("The account type".into()),
                picklist_values: vec![PicklistValue {
                    label: "Customer".into(),
                    value: "Customer".into(),
                    active: true,
                    default_value: false,
                    valid_for: None,
                }],
                ..Default::default()
            }],
            child_relationships: vec![ChildRelationship {
                child_sobject: "Contact".into(),
                field: "AccountId".into(),
                relationship_name: Some("Contacts".into()),
            }],
            record_type_infos: vec![RecordTypeInfo {
                name: "Master".into(),
                developer_name: "Master".into(),
                active: true,
                master: true,
                available: true,
                record_type_id: None,
            }],
            ..Default::default()
        };

        let json = serde_json::to_value(object_detail_dto(&schema)).unwrap();
        assert_eq!(json["keyPrefix"], "001");
        assert_eq!(json["fields"][0]["fieldType"], "picklist");
        assert_eq!(json["fields"][0]["inlineHelpText"], "The account type");
        assert_eq!(json["fields"][0]["picklistValues"][0]["defaultValue"], false);
        assert_eq!(json["childRelationships"][0]["childSObject"], "Contact");
        assert_eq!(json["recordTypes"][0]["developerName"], "Master");
    }

    fn dep(name: &str) -> sqlite::FieldDep {
        sqlite::FieldDep {
            component_type: "ApexClass".into(),
            component_name: name.into(),
            component_id: "01pXXX".into(),
        }
    }

    #[test]
    fn cached_where_used_forced_refresh_ignores_cache() {
        let cached = Some((vec![dep("AccountService")], 1234));
        assert!(cached_where_used(true, cached).is_none());
    }

    #[test]
    fn cached_where_used_miss_returns_none() {
        assert!(cached_where_used(false, None).is_none());
    }

    #[test]
    fn cached_where_used_hit_maps_dto() {
        let dto = cached_where_used(false, Some((vec![dep("AccountService")], 1234)))
            .expect("cache hit → dto");
        assert!(dto.supported);
        assert_eq!(dto.fetched_at, Some(1234));
        assert_eq!(dto.items.len(), 1);
        assert_eq!(dto.items[0].component_name, "AccountService");
    }

    #[test]
    fn cached_where_used_zero_deps_is_a_supported_hit() {
        let dto = cached_where_used(false, Some((vec![], 5678))).expect("fetched-and-zero → dto");
        assert!(dto.supported);
        assert!(dto.items.is_empty());
        assert_eq!(dto.fetched_at, Some(5678));
    }
}
