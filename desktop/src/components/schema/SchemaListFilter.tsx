import { Search } from "lucide-react";

/**
 * Shared filter box for the schema browser's list panes (ObjectList,
 * FieldTable): a search input with a leading icon. Placeholder / aria-label are
 * per-pane; markup is identical across them.
 */
export function SchemaListFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative shrink-0 border-b border-border p-2">
      <Search
        size={13}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="focus-accent w-full rounded-md border border-border bg-input py-1 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}
