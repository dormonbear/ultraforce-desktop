import { useState } from "react";
import { Globe, Check, Loader2, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Divider } from "@astryxdesign/core/Divider";
import { useOrgs } from "../org";
import { ConnectOrgDialog } from "./ConnectOrg";

/** Top-bar org picker: lists `sf` orgs and sets the target org for all calls. */
export function OrgSelector() {
  const { orgs, selected, loading, error, select } = useOrgs();
  const [connectOpen, setConnectOpen] = useState(false);

  const cur = orgs.find((o) => o.username === selected);
  const label = error
    ? "Org error"
    : loading
      ? "Loading…"
      : cur
        ? (cur.alias ?? cur.username)
        : orgs.length
          ? "Select org"
          : "No orgs";

  return (
    <>
      <DropdownMenu
        menuWidth={288}
        className="max-h-72 overflow-auto text-[12px]"
        button={{
          label,
          "aria-label": "Select Salesforce org",
          variant: "secondary",
          size: "sm",
          isDisabled: loading || orgs.length === 0,
          icon: loading ? (
            <Loader2 size={12} className="spin text-muted-foreground" />
          ) : (
            <Globe size={12} className="text-primary" />
          ),
        }}
      >
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.username}
            onClick={() => select(o.username)}
            className={o.username === selected ? "text-primary" : undefined}
            label={
              <span className="truncate">
                {o.alias ? `${o.alias} · ` : ""}
                {o.username}
              </span>
            }
            endContent={
              <span className="flex items-center gap-1 text-muted-foreground">
                {o.isDefault && <span className="text-[11px]">default</span>}
                {o.username === selected && (
                  <Check size={12} className="text-primary" />
                )}
              </span>
            }
          />
        ))}
        <Divider />
        <DropdownMenuItem
          icon={<Plus size={12} />}
          label="Connect another org…"
          onClick={() => setConnectOpen(true)}
          className="text-text-dim"
        />
      </DropdownMenu>
      <ConnectOrgDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}
