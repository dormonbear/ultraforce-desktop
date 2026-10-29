import { useMemo } from "react";
import { QueryBuilder, defaultCombinators, defaultOperators, type Field, type RuleGroupType } from "react-querybuilder";
import { X } from "lucide-react";
import { useI18n, type MessageKey } from "../../../i18n";
import "react-querybuilder/dist/query-builder.css";

/** Lucide icon instead of RQB's text "⨯" — centers geometrically. */
const removeLabel = { label: <X size={13} aria-hidden /> };
const operatorLabels: Record<string, MessageKey> = {
  contains: "contains",
  beginsWith: "begins with",
  endsWith: "ends with",
  doesNotContain: "does not contain",
  doesNotBeginWith: "does not begin with",
  doesNotEndWith: "does not end with",
  null: "is null",
  notNull: "is not null",
  in: "in",
  notIn: "not in",
  between: "between",
  notBetween: "not between",
};

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
  const { t } = useI18n();
  const operators = useMemo(() => defaultOperators.map((operator) => {
    const key = operatorLabels[operator.name];
    return key ? { ...operator, label: t(key) } : operator;
  }), [t]);
  const combinators = useMemo(() => defaultCombinators.map((combinator) => ({
    ...combinator,
    label: t(combinator.name === "and" ? "AND" : "OR"),
  })), [t]);
  const translations = useMemo(() => ({
    fields: { title: t("Field") },
    operators: { title: t("Operator") },
    values: { title: t("Values") },
    value: { title: t("Value") },
    addRule: { label: t("+ Rule"), title: t("Add rule") },
    addGroup: { label: t("+ Group"), title: t("Add group") },
    removeRule: { ...removeLabel, title: t("Remove rule") },
    removeGroup: { ...removeLabel, title: t("Remove group") },
    combinators: { title: t("Combinator") },
    notToggle: { label: t("Not"), title: t("Invert this group") },
    matchMode: { title: t("Match mode") },
    matchThreshold: { title: t("Match threshold") },
  }), [t]);
  return (
    <div className="uf-querybuilder border-b border-border bg-card px-4 py-2">
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={onQueryChange}
        showNotToggle
        resetOnFieldChange
        operators={operators}
        combinators={combinators}
        translations={translations}
      />
    </div>
  );
}
