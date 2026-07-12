import { useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { useOrgs } from "../org";
import { orgColor, orgDisplayName, type OrgColor } from "../orgConfig";
import { OrgSwitcherModal } from "./OrgSwitcherModal";
import { ConnectOrgDialog } from "./ConnectOrg";
import type { OrgConfig, OrgDto } from "../types";

/** Resolve the active org + its config/color from the shared org state (pure). */
function currentOrg(
  orgs: OrgDto[],
  selected: string | null,
  configs: Record<string, OrgConfig>,
) {
  const cur = orgs.find((o) => o.username === selected);
  const cfg = selected ? configs[selected] : undefined;
  return { cur, cfg, color: orgColor(cfg?.color) };
}

/** Badge text when no org is selected. */
function emptyLabel(hasOrgs: boolean): string {
  return hasOrgs ? "Select org" : "No orgs";
}

/** Resolve the badge text (pure): error > loading > current org name > empty states. */
function badgeLabel(
  state: { error: string | null; loading: boolean; hasOrgs: boolean },
  cur: OrgDto | undefined,
  cfg: OrgConfig | undefined,
): string {
  if (state.error) return "Org error";
  if (state.loading) return "Loading…";
  return cur ? orgDisplayName(cfg, cur) : emptyLabel(state.hasOrgs);
}

/** Style + classes for the badge button — filled with the org's preset color when set. */
function badgeAppearance(color: OrgColor | undefined, disabled: boolean) {
  const palette = color
    ? "border-transparent"
    : "border-border bg-secondary text-foreground hover:bg-muted";
  const cursor = disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer";
  return {
    style: color
      ? { background: color.bg, color: color.fg, borderColor: color.bg }
      : undefined,
    className: `focus-accent flex h-7 max-w-56 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium ${palette} ${cursor}`,
  };
}

/** Leading badge icon: spinner while loading, globe otherwise (dimmed when the
 * badge has no color fill). */
function BadgeIcon({ loading, colored }: { loading: boolean; colored: boolean }) {
  if (loading) return <Loader2 size={12} className="spin shrink-0" />;
  return (
    <Globe
      size={12}
      className="shrink-0"
      style={colored ? undefined : { opacity: 0.8 }}
    />
  );
}

/** Titlebar org badge: shows the active org (alias, filled with its preset color
 * when set) and opens the switcher modal. Replaces the old dropdown selector. */
export function OrgBadge() {
  const { orgs, selected, configs, loading, error } = useOrgs();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const { cur, cfg, color } = currentOrg(orgs, selected, configs);
  const disabled = loading || orgs.length === 0;
  const label = badgeLabel({ error, loading, hasOrgs: orgs.length > 0 }, cur, cfg);
  const { style, className } = badgeAppearance(color, disabled);
  const aria = cur ? `Current org: ${label}. Switch org` : "Select Salesforce org";

  return (
    <>
      <button
        type="button"
        onClick={() => setSwitcherOpen(true)}
        disabled={disabled}
        aria-label={aria}
        aria-haspopup="dialog"
        style={style}
        className={className}
      >
        <BadgeIcon loading={loading} colored={color != null} />
        <span className="truncate">{label}</span>
      </button>
      <OrgSwitcherModal
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        onConnect={() => {
          setSwitcherOpen(false);
          setConnectOpen(true);
        }}
      />
      <ConnectOrgDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}
