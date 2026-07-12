// Module-level mirror of the active org for Monaco language providers.
// Completion / signature-help providers register once on the singleton monaco
// instance (outside the React tree), so they can't read `useOrgs()`. OrgProvider
// keeps this in sync via `setActiveOrg` on every org change; the providers read
// it at request time so each keystroke is scoped to the current org (null = the
// backend's CLI-default fallback).
let activeOrg: string | null = null;

export function setActiveOrg(org: string | null): void {
  activeOrg = org;
}

export function getActiveOrg(): string | null {
  return activeOrg;
}
