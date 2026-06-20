import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Check, ChevronDown } from "lucide-react";
import type { OrgDto } from "../types";

/** Top-bar org picker: lists `sf` orgs and sets the target org for all calls. */
export function OrgSelector() {
  const [orgs, setOrgs] = useState<OrgDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
      .catch((e) => setError(typeof e === "string" ? e : String(e)));
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (o: OrgDto) => {
    setSelected(o.username);
    setOpen(false);
    invoke("set_target_org", { username: o.username });
  };

  const label = (() => {
    const cur = orgs.find((o) => o.username === selected);
    if (error) return "org error";
    if (!cur) return orgs.length ? "select org" : "no orgs";
    return cur.alias ?? cur.username;
  })();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Select Salesforce org"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={orgs.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="focus-accent inline-flex cursor-pointer items-center gap-2 rounded-[3px] border border-hair px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-dim transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Globe size={12} className="text-primary" />
        <span className="normal-case tracking-normal">{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && orgs.length > 0 && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-1 max-h-72 w-72 overflow-auto rounded-[3px] border border-hair bg-surface py-1 text-[12px] shadow-lg"
        >
          {orgs.map((o) => (
            <li key={o.username}>
              <button
                type="button"
                role="option"
                aria-selected={o.username === selected}
                onClick={() => choose(o)}
                className={`focus-accent flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-hair/40 ${
                  o.username === selected ? "text-primary" : "text-text"
                }`}
              >
                <span className="truncate">
                  {o.alias ? `${o.alias} · ` : ""}
                  {o.username}
                </span>
                <span className="flex items-center gap-1 text-text-faint">
                  {o.is_default && <span className="text-[10px] uppercase">default</span>}
                  {o.username === selected && <Check size={12} className="text-primary" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
