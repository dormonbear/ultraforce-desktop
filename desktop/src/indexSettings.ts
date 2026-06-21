import { getJson, setJson } from "./store";

/** Persisted namespace-scoping policy for the org index.
 * "all" = index everything; "unmanaged" = drop managed-package members.
 * (The backend also accepts a comma-separated allow-list of namespace prefixes.) */
const NS_KEY = "settings.indexNamespaces";

export type NamespacePolicy = string; // "all" | "unmanaged" | "ns1,ns2,…"

export const getNamespacePolicy = (): Promise<NamespacePolicy> =>
  getJson<NamespacePolicy>(NS_KEY, "all");

export const setNamespacePolicy = (value: NamespacePolicy): Promise<void> =>
  setJson(NS_KEY, value);
