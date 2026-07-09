import { useMemo } from "react";
import {
  Typeahead,
  createStaticSource,
  type SearchableItem,
} from "@astryxdesign/core/Typeahead";

interface ComboOption {
  id: string;
  name: string;
  kind: string;
}

type Item = SearchableItem<ComboOption>;

const label = (o: ComboOption): string => `${o.name} · ${o.kind}`;
/** Cap the dropdown so large entity sets (~2000 users) never render thousands of nodes. */
const MAX = 50;

interface Props {
  options: ComboOption[];
  /** Label of the current selection, or "" when none. */
  valueLabel: string;
  placeholder: string;
  onSelect: (o: ComboOption) => void;
  className?: string;
}

/** Searchable entity picker built on Astryx Typeahead. Substring-filters a static
 * source by `name · kind` and caps rendered results via `maxMenuItems`. */
export function EntityCombobox({
  options,
  valueLabel,
  placeholder,
  onSelect,
  className,
}: Props) {
  const source = useMemo(
    () =>
      createStaticSource(
        options.map<Item>((o) => ({ id: o.id, label: label(o), auxiliaryData: o })),
      ),
    [options],
  );

  const value: Item | null = valueLabel ? { id: valueLabel, label: valueLabel } : null;

  return (
    <Typeahead<Item>
      label={placeholder}
      isLabelHidden
      placeholder={placeholder}
      searchSource={source}
      value={value}
      onChange={(item) => {
        if (item?.auxiliaryData) onSelect(item.auxiliaryData);
      }}
      hasClear={false}
      hasEntriesOnFocus
      maxMenuItems={MAX}
      size="sm"
      debounceMs={0}
      emptySearchResultsText="No match."
      className={className}
    />
  );
}
