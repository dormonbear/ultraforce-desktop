import { X } from "lucide-react";
import { useI18n } from "../i18n";
import type { QueryPlanDto } from "../types";

/** Compact view of a SOQL EXPLAIN result. Highlights non-selective plans
 *  (relativeCost > 1.0, Salesforce's own selectivity threshold). */
export function QueryPlanView({
  plan,
  onClose,
}: {
  plan: QueryPlanDto;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="select-text flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="micro-label">
          {t("Query plan")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close plan")}
          className="focus-accent inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {plan.plans.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">
            {t("No plan returned")}
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-text-dim">
                <th className="px-2 py-1">{t("Object")}</th>
                <th className="px-2 py-1">{t("Leading operation")}</th>
                <th className="px-2 py-1 text-right">{t("Cost")}</th>
                <th className="px-2 py-1 text-right">{t("Cardinality")}</th>
                <th className="px-2 py-1 text-right">{t("Object rows")}</th>
                <th className="px-2 py-1">{t("Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {plan.plans.map((p, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-2 py-1 font-medium">{p.sobjectType}</td>
                  <td className="px-2 py-1">{p.leadingOperationType}</td>
                  <td
                    className={
                      p.relativeCost > 1
                        ? "tnum px-2 py-1 text-right font-medium text-destructive"
                        : "tnum px-2 py-1 text-right"
                    }
                  >
                    {p.relativeCost.toFixed(2)}
                  </td>
                  <td className="tnum px-2 py-1 text-right">{p.cardinality}</td>
                  <td className="tnum px-2 py-1 text-right">
                    {p.sobjectCardinality}
                  </td>
                  <td className="px-2 py-1 text-text-dim">
                    {p.notes.map((n) => n.description).join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
