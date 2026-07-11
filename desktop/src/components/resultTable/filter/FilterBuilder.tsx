import { QueryBuilder, type Field, type RuleGroupType } from "react-querybuilder";
import { X } from "lucide-react";
import "react-querybuilder/dist/query-builder.css";

/** Lucide icon instead of RQB's text "⨯" — centers geometrically. */
const removeLabel = { label: <X size={13} aria-hidden /> };

/** Thin RQB wrapper: UI only — evaluation lives in filter/evaluate.ts. */
export function FilterBuilder({
  fields,
  query,
  onQueryChange,
}: {
  fields: Field[];
  query: RuleGroupType;
  onQueryChange: (q: RuleGroupType) => void;
}) {
  return (
    <div className="uf-querybuilder border-b border-border bg-card px-4 py-2">
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onQueryChange}
        showNotToggle
        resetOnFieldChange
        translations={{ removeRule: removeLabel, removeGroup: removeLabel }}
      />
    </div>
  );
}
