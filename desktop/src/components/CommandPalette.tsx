import { Database, Moon, ScrollText, Terminal } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "../theme";
import { useOrgs } from "../org";

type PanelId = "soql" | "apex" | "logs";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPanel: (panel: PanelId) => void;
}

const PANELS: Array<{ id: PanelId; label: string; icon: typeof Database }> = [
  { id: "soql", label: "Go to SOQL", icon: Database },
  { id: "apex", label: "Go to Apex", icon: Terminal },
  { id: "logs", label: "Go to Logs", icon: ScrollText },
];

export function CommandPalette({
  open,
  onOpenChange,
  onSelectPanel,
}: CommandPaletteProps) {
  const { toggle } = useTheme();
  const { orgs, error: orgError, select } = useOrgs();

  const close = () => onOpenChange(false);

  const selectPanel = (panel: PanelId) => {
    onSelectPanel(panel);
    close();
  };

  const selectOrg = (username: string) => {
    select(username);
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search commands..." />
      <CommandList>
        <CommandEmpty>No command found.</CommandEmpty>
        <CommandGroup heading="Panels">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <CommandItem key={id} onSelect={() => selectPanel(id)}>
              <Icon size={14} />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem
            onSelect={() => {
              toggle();
              close();
            }}
          >
            <Moon size={14} />
            Toggle light/dark
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Orgs">
          {orgError && <CommandItem disabled>{orgError}</CommandItem>}
          {!orgError && orgs.length === 0 && <CommandItem disabled>No orgs</CommandItem>}
          {orgs.map((org) => (
            <CommandItem
              key={org.username}
              onSelect={() => selectOrg(org.username)}
            >
              <span className="truncate">
                {org.alias ? `${org.alias} · ` : ""}
                {org.username}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
