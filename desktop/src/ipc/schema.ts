import { invoke } from "@tauri-apps/api/core";
import type {
  FieldDependencies,
  SchemaObject,
  SchemaObjectDetail,
  SchemaSearchHit,
} from "../types";

/** Cheap, immediate sObject-name cache warm-up for FROM completion. */
export function warmSchema(org: string): Promise<void> {
  return invoke("warm_schema", { org });
}

/** Full index / delta-sync of an org's schema + Apex, scoped by `namespaces`. */
export function indexOrg(org: string, namespaces: string): Promise<void> {
  return invoke("index_org", { org, namespaces });
}

/** Force a rebuild of an org's cached schema index. */
export function reindexOrg(org: string, namespaces: string): Promise<void> {
  return invoke("reindex_org", { org, namespaces });
}

/** List all queryable sObjects for the schema browser. */
export const listSchemaObjects = (org: string) =>
  invoke<SchemaObject[]>("schema_list_objects", { org });

/** Full schema detail (fields, child relationships, record types) for one object. */
export const getSchemaObjectDetail = (org: string, object: string) =>
  invoke<SchemaObjectDetail>("schema_object_detail", { org, object });

/** Search objects/fields for the schema palette. */
export const searchSchema = (org: string, query: string, limit?: number) =>
  invoke<SchemaSearchHit[]>("schema_search", { org, query, limit });

/** Where-used ("field dependencies") for a single field. */
export const getFieldDependencies = (
  org: string,
  object: string,
  field: string,
  refresh: boolean,
) =>
  invoke<FieldDependencies>("schema_field_dependencies", {
    org,
    object,
    field,
    refresh,
  });
