import { useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface ComboOption {
  id: string;
  name: string;
  kind: string;
}

const label = (o: ComboOption): string => `${o.name} · ${o.kind}`;
const MAX = 50;

interface Props {
  options: ComboOption[];
  /** Label of the current selection, or "" when none. */
  valueLabel: string;
  placeholder: string;
  onSelect: (o: ComboOption) => void;
  className?: string;
}

/** Searchable entity picker. cmdk's own filter is off and results are capped so
 * large entity sets (~2000 users) never mount thousands of nodes. */
// fallow-ignore-next-line complexity
export function EntityCombobox({
  options,
  valueLabel,
  placeholder,
  onSelect,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => label(o).toLowerCase().includes(q))
    : options;
  const matches = filtered.slice(0, MAX);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger
        className={cn(
          "focus-accent flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded border border-border bg-card px-1.5 text-left text-[11px]",
          valueLabel ? "text-foreground" : "text-text-dim",
          className,
        )}
      >
        <span className="truncate">{valueLabel || placeholder}</span>
        <ChevronsUpDown size={12} className="ml-auto shrink-0 text-text-dim" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-72 rounded-md border border-border bg-card p-0 shadow-md outline-none"
        >
          <Command shouldFilter={false} className="bg-card">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search…"
              className="text-[11px]"
            />
            <CommandList className="max-h-64">
              <CommandEmpty className="py-4 text-[11px]">No match.</CommandEmpty>
              {matches.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onSelect(o);
                    setOpen(false);
                  }}
                  className="cursor-pointer gap-1 text-[11px]"
                >
                  <span className="truncate">{o.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-text-dim">
                    {o.kind}
                  </span>
                </CommandItem>
              ))}
              {filtered.length > MAX && (
                <div className="px-2 py-1 text-[10px] text-text-dim">
                  Showing first {MAX} of {filtered.length} — refine your search.
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
