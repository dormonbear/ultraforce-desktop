import { parseSfError } from "../errorFormat";
import { useI18n } from "../i18n";

/** Salesforce error block: parsed title + detail with a collapsible raw section.
 * Shared by the SOQL and Apex result panes. */
export function SfErrorDetail({
  error,
  className = "",
}: {
  error: string;
  className?: string;
}) {
  const { t } = useI18n();
  const e = parseSfError(error);
  return (
    <div
      className={`select-text rounded-md border border-destructive/40 bg-card p-3 ${className}`}
    >
      <div className="text-[13px] font-medium text-destructive">{e.title === "Error" ? t("Error") : e.title}</div>
      <div className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">
        {e.detail}
      </div>
      {e.raw !== e.detail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-text-dim">
            {t("Raw error")}
          </summary>
          <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[11px] text-text-dim">
            {e.raw}
          </pre>
        </details>
      )}
    </div>
  );
}
