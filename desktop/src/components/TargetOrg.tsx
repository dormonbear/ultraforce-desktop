import { useOrgs } from "../org";
import { orgColor, orgDisplayName } from "../orgConfig";

/**
 * Read-only "this runs against X" marker for an editor toolbar.
 *
 * The org is global state (one selection shared by every tab, switched from the
 * header's OrgBadge), so this is deliberately NOT a second picker — a control
 * here would imply per-tab orgs, which don't exist. It only closes the distance
 * between the Run button and the answer to "run it where?".
 *
 * Name and dot color come from the same helpers OrgBadge uses, so the toolbar
 * and the titlebar can never disagree about what the active org is called.
 */
export function TargetOrg() {
  const { orgs, selected, configs } = useOrgs();
  const cur = orgs.find((o) => o.username === selected);
  if (!cur) return null;
  const cfg = configs[cur.username];
  const name = orgDisplayName(cfg, cur);
  // The accent default is a class so only a configured preset needs an override.
  const dot = orgColor(cfg?.color)?.bg;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-dim"
      aria-label={`Target org: ${name}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-primary/60"
        style={dot ? { background: dot } : undefined}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
