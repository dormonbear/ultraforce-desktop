import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import type { SchemaSearchHit } from "../../types";
import { searchSchema } from "../../ipc/schema";
import { formatIpcError } from "../../errorFormat";
import { navigateTo } from "./useSchemaNav";

const DEBOUNCE_MS = 150;
const LIMIT = 30;

/**
 * Split a search snippet into plain text and `[…]`-marked (highlighted) runs,
 * rendered as `<mark>` — never via dangerouslySetInnerHTML.
 */
function renderSnippet(snippet: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\[([^\]]*)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(snippet)) !== null) {
    if (m.index > last) parts.push(snippet.slice(last, m.index));
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-primary/20 px-0.5 text-foreground"
      >
        {m[1]}
      </mark>,
    );
    last = regex.lastIndex;
  }
  if (last < snippet.length) parts.push(snippet.slice(last));
  return parts;
}

/**
 * Deep-search bar mounted at the top of the Schema tab. Debounced full-text
 * search over the org's cached schema (field names/labels, picklist values,
 * help text, formula source); picking a hit navigates the three panes via the
 * shared `useSchemaNav` channel that SchemaPanel already subscribes to.
 */
export const SchemaSearchBar = memo(function SchemaSearchBar({
  org,
}: {
  org: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchemaSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow response landing after the query moved on.
  const latestQuery = useRef("");

  useEffect(() => {
    latestQuery.current = query;
    if (!query) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (!org) {
      // Surface a hint instead of querying when no org is selected.
      setResults([]);
      setOpen(true);
      return;
    }
    const handle = setTimeout(() => {
      searchSchema(org, query, LIMIT)
        .then((hits) => {
          if (latestQuery.current !== query) return;
          setResults(hits);
          setActive(0);
          setOpen(true);
        })
        .catch((e: unknown) => {
          if (latestQuery.current !== query) return;
          toast.error(`Schema: ${formatIpcError(e)}`);
          setResults([]);
          setOpen(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [org, query]);

  const pick = useCallback((hit: SchemaSearchHit) => {
    navigateTo({ object: hit.objectName, field: hit.fieldName });
    setQuery("");
    setResults([]);
    setOpen(false);
  }, []);

  const clear = useCallback(() => {
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setOpen(false);
        setResults([]);
        return;
      }
      if (!open || results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = results[active];
        if (hit) pick(hit);
      }
    },
    [open, results, active, pick],
  );

  const showDropdown = open && (org ? results.length > 0 : Boolean(query));

  return (
    <div className="relative shrink-0 border-b border-border p-2">
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          placeholder="Search fields, picklist values, formulas…"
          data-uf-search=""
          aria-label="Search schema"
          className="focus-accent w-full rounded-md border border-border bg-input py-1 pl-7 pr-7 text-[12px] text-foreground placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            className="focus-accent absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {showDropdown && (
        <div className="absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {!org ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              Select an org first
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto p-1">
              {results.map((hit, i) => (
                <li key={`${hit.objectName}.${hit.fieldName}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(hit)}
                    onMouseEnter={() => setActive(i)}
                    aria-current={i === active ? "true" : undefined}
                    className={`flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left ${
                      i === active
                        ? "bg-accent text-foreground"
                        : "text-text-dim hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="truncate text-[12px] font-medium">
                        {`${hit.objectName}.${hit.fieldName}`}
                      </span>
                      {hit.fieldLabel && hit.fieldLabel !== hit.fieldName && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {hit.fieldLabel}
                        </span>
                      )}
                    </span>
                    {hit.snippet && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {renderSnippet(hit.snippet)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});
