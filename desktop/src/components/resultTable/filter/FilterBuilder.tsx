import { QueryBuilder, type Field, type RuleGroupType } from "react-querybuilder";
import "react-querybuilder/dist/query-builder.css";

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
      />
    </div>
  );
}
