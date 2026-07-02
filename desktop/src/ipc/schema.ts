import { invoke } from "@tauri-apps/api/core";

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
