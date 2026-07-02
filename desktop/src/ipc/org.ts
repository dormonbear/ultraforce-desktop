import { invoke } from "@tauri-apps/api/core";
import type { OrgDto, SfStatus } from "../types";

/** Orgs known to the `sf` CLI. */
export function listOrgs(): Promise<OrgDto[]> {
  return invoke<OrgDto[]>("list_orgs");
}

/** Set the target org for all subsequent backend calls. */
export function setTargetOrg(username: string): Promise<void> {
  return invoke("set_target_org", { username });
}

/** Run `sf org login web` (opens the browser for OAuth). */
export function loginOrg(args: {
  instanceUrl: string | null;
  alias: string | null;
  setDefault: boolean;
}): Promise<void> {
  return invoke("login_org", args);
}

/** Health of the `sf` CLI installation (found / version / PATH). */
export function sfStatus(): Promise<SfStatus> {
  return invoke<SfStatus>("sf_status");
}
