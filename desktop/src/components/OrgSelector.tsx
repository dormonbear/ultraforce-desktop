import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Globe, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OrgDto } from "../types";

/** Top-bar org picker: lists `sf` orgs and sets the target org for all calls. */
export function OrgSelector() {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<OrgDto[]>("list_orgs")
      .then((list) => {
        setOrgs(list);
        const def = list.find((o) => o.is_default) ?? list[0];
        if (def) {
          setSelected(def.username);
          invoke("set_target_org", { username: def.username });
        }
      })
      .catch((e) => {
        const message = typeof e === "string" ? e : String(e);
        toast.error(message);
        setError(message);
      });
  }, []);

  const choose = (o: OrgDto) => {
    setSelected(o.username);
    invoke("set_target_org", { username: o.username });
  };

  const label = (() => {
    const cur = orgs.find((o) => o.username === selected);
    if (error) return "org error";
    if (!cur) return orgs.length ? "select org" : "no orgs";
    return cur.alias ?? cur.username;
  })();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Select Salesforce org"
        disabled={orgs.length === 0}
        className="focus-accent inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Globe size={12} className="text-primary" />
        <span className="normal-case tracking-normal">{label}</span>
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-72 w-72 overflow-auto rounded-md border-border bg-card py-1 text-[12px]"
      >
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.username}
            onSelect={() => choose(o)}
            className={`focus-accent flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-accent/40 ${
              o.username === selected ? "text-primary" : "text-foreground"
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
