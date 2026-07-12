import { invoke } from "@tauri-apps/api/core";
import type {
  FieldDependencies,
  IndexStatus,
  SchemaObject,
  SchemaObjectDetail,
  SchemaSearchHit,
} from "../types";

/**
 * Idempotently make `org`'s index usable: single-flight per org (concurrent
 * calls join the in-flight run), a no-op when the index is fresh, otherwise a
 * snapshot install + delta-sync or a full first index. Replaces the former
 * parallel `warmSchema` + `indexOrg` calls.
 */
export function ensureReady(org: string, namespaces: string): Promise<void> {
  return invoke("ensure_ready", { org, namespaces });
}

/** Force a full rebuild of an org's cached schema index (queued behind any run). */
export function reindexOrg(org: string, namespaces: string): Promise<void> {
  return invoke("reindex_org", { org, namespaces });
}

/** Queryable index-lifecycle snapshot for `org` (seeds late-mounting indicators). */
export function indexStatus(org: string): Promise<IndexStatus> {
  return invoke<IndexStatus>("index_status", { org });
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
