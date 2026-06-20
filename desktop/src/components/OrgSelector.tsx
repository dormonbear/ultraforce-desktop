import { Globe, Check, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgs } from "../org";

/** Top-bar org picker: lists `sf` orgs and sets the target org for all calls. */
export function OrgSelector() {
  const { orgs, selected, loading, error, select } = useOrgs();

  const cur = orgs.find((o) => o.username === selected);
  const label = error
    ? "org error"
    : loading
      ? "loading…"
      : cur
        ? (cur.alias ?? cur.username)
        : orgs.length
          ? "select org"
          : "no orgs";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select Salesforce org"
        disabled={loading || orgs.length === 0}
        className="focus-accent inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={12} className="spin text-muted-foreground" />
        ) : (
          <Globe size={12} className="text-primary" />
        )}
        <span className="normal-case tracking-normal">{label}</span>
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-72 overflow-auto text-[12px]"
      >
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.username}
            onSelect={() => select(o.username)}
            className={`flex cursor-pointer items-center justify-between gap-2 ${
              o.username === selected ? "text-primary" : ""
            }`}
          >
            <span className="truncate">
              {o.alias ? `${o.alias} · ` : ""}
              {o.username}
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {o.is_default && (
                <span className="text-[10px] uppercase">default</span>
              )}
              {o.username === selected && (
                <Check size={12} className="text-primary" />
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
