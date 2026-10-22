import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { FieldDependencies, FieldDependency, SchemaField } from "../../types";
import { getFieldDependencies } from "../../ipc/schema";
import { formatIpcError } from "../../errorFormat";
import { useI18n } from "../../i18n";

const DISCLAIMER =
  "Powered by the beta Dependency API — some report types, joined reports and private-folder reports are not detected.";

const AGE_MESSAGES = {
  minute: ["{count} minute ago", "{count} minutes ago"],
  hour: ["{count} hour ago", "{count} hours ago"],
  day: ["{count} day ago", "{count} days ago"],
} as const;

/** Localized coarse age from an epoch-ms timestamp. / 将毫秒时间戳转换为本地化相对时间。 */
function relativeTime(
  ms: number,
  locale: string,
  t: ReturnType<typeof useI18n>["t"],
  nativeFormat: Intl.RelativeTimeFormat | null,
): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return t("just now");
  const format = (value: number, unit: keyof typeof AGE_MESSAGES) => {
    if (nativeFormat) return nativeFormat.format(-value, unit);
    return t(AGE_MESSAGES[unit][value === 1 ? 0 : 1], { count: value.toLocaleString(locale) });
  };
  const min = Math.round(sec / 60);
  if (min < 60) return format(min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return format(hr, "hour");
  const day = Math.round(hr / 24);
  return format(day, "day");
}

/** Group where-used rows by componentType, preserving first-seen order. */
function groupByType(items: FieldDependency[]): [string, FieldDependency[]][] {
  const groups = new Map<string, FieldDependency[]>();
  for (const item of items) {
    const bucket = groups.get(item.componentType);
    if (bucket) bucket.push(item);
    else groups.set(item.componentType, [item]);
  }
  return [...groups.entries()];
}

function GroupList({ items }: { items: FieldDependency[] }) {
  const { t, locale } = useI18n();
  const groups = groupByType(items);
  if (groups.length === 0) {
    return <div className="text-[12px] text-muted-foreground">{t("No references found.")}</div>;
  }
  return (
    <>
      {groups.map(([type, rows]) => (
        <div key={type} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-foreground">{type}</span>
            <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">
              {rows.length.toLocaleString(locale)}
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <li
                key={row.componentId}
                className="truncate pl-3 font-mono text-[11px] text-foreground"
              >
                {row.componentName}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function Footer({ fetchedAt }: { fetchedAt: number | null }) {
  const { t, locale } = useI18n();
  const nativeFormat = useMemo(
    () => typeof Intl.RelativeTimeFormat === "function"
      ? new Intl.RelativeTimeFormat(locale, { numeric: "always" })
      : null,
    [locale],
  );
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-1.5">
      {fetchedAt !== null && (
        <div className="text-[10px] text-muted-foreground">
          {t("fetched {time}", { time: relativeTime(fetchedAt, locale, t, nativeFormat) })}
        </div>
      )}
      <div className="text-[10px] leading-snug text-muted-foreground">{t(DISCLAIMER)}</div>
    </div>
  );
}

/** Body under the expander: one of loading / error-retry / unsupported / groups. */
function ReferencesBody({
  loading,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  data: FieldDependencies | null;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loading) {
    return <div className="text-[12px] text-muted-foreground">{t("Loading…")}</div>;
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span>{t("Couldn’t load references.")}</span>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded border border-border px-2 py-0.5 text-foreground hover:bg-secondary"
        >
          {t("Retry")}
        </button>
      </div>
    );
  }
  if (!data) return null;
  // Every result state (groups, zero deps, or the unsupported note) carries the
  // permanent beta-API disclaimer; `fetchedAt` is null for unsupported fields,
  // so the "fetched …" line only shows on supported results.
  return (
    <>
      {data.supported ? (
        <GroupList items={data.items} />
      ) : (
        <div className="text-[12px] text-muted-foreground">
          {t("Standard fields aren’t tracked by the Dependency API.")}
        </div>
      )}
      <Footer fetchedAt={data.fetchedAt} />
    </>
  );
}

/**
 * Collapsible "Where is this used?" section for the field detail pane. Fetches a
 * field's Dependency-API references lazily on first expand (cached backend, so
 * re-expanding is free); a refresh button forces a re-fetch. Standard fields the
 * API can't track render a muted note instead. Resets to collapsed/unfetched
 * whenever the selected field changes.
 */
export const ReferencesSection = memo(function ReferencesSection({
  org,
  object,
  field,
}: {
  org: string | null;
  object: string | null;
  field: SchemaField;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<FieldDependencies | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Request generation: bumped whenever the target changes so an in-flight
  // response for a previous field can't repopulate the fresh state.
  const genRef = useRef(0);

  // Reset when the selected field (or org/object) changes.
  useEffect(() => {
    genRef.current += 1;
    setExpanded(false);
    setData(null);
    setLoading(false);
    setError(false);
    return () => {
      genRef.current += 1;
    };
  }, [org, object, field.name]);

  const load = useCallback(
    (refresh: boolean) => {
      if (!org || !object) return;
      const gen = genRef.current;
      setLoading(true);
      setError(false);
      getFieldDependencies(org, object, field.name, refresh)
        .then((result) => {
          if (genRef.current !== gen) return; // stale: field changed mid-flight
          setData(result);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (genRef.current !== gen) return;
          setError(true);
          setLoading(false);
          toast.error(t("References: {error}", { error: formatIpcError(e) }));
        });
    },
    [org, object, field.name, t],
  );

  const onToggle = useCallback(() => {
    setExpanded((prev) => !prev);
    if (!expanded && data === null && !loading && !error) load(false);
  }, [expanded, data, loading, error, load]);

  const showRefresh = expanded && !loading && Boolean(data?.supported);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t("Where is this used?")}
        </button>
        {showRefresh && (
          <button
            type="button"
            aria-label={t("Refresh references")}
            onClick={() => load(true)}
            className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pl-4">
          <ReferencesBody
            loading={loading}
            error={error}
            data={data}
            onRetry={() => load(false)}
          />
        </div>
      )}
    </div>
  );
});
