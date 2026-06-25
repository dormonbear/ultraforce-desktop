import { Plus, Trash2, RefreshCw, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isExpired } from "../traceTime";
import type { useLoggingConfig } from "../useLoggingConfig";

type Cfg = ReturnType<typeof useLoggingConfig>;

const LOG_TYPES = ["USER_DEBUG", "CLASS_TRACING", "DEVELOPER_LOG"] as const;

/** Friendly labels for the SF LogType picklist values. */
const LOG_TYPE_LABELS: Record<string, string> = {
  DEVELOPER_LOG: "Developer log",
  USER_DEBUG: "User debug",
  CLASS_TRACING: "Class tracing",
};
const typeLabel = (t: string): string => LOG_TYPE_LABELS[t] ?? t;

function defaultLogType(kind: string): string {
  return kind === "ApexClass" || kind === "ApexTrigger" ? "CLASS_TRACING" : "USER_DEBUG";
}

// Native <select>: light + compact, and the entity picker holds ~2000 users
// where a Radix Select would freeze on open.
const SEL =
  "h-6 cursor-pointer rounded border border-border bg-card px-1 text-[11px] text-foreground focus-accent";

/** Editable table of TraceFlag records across users / classes / triggers. */
export function TraceFlagsTable({ cfg }: { cfg: Cfg }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-0.5">
        <span className="text-[11px] text-text-dim">{cfg.flags.length} trace flag(s)</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Add trace flag"
            onClick={cfg.addFlag}
            className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
          >
            <Plus size={12} /> Add Trace Flag
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh expired trace flags"
            onClick={cfg.refreshExpired}
            className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
          >
            <RefreshCw size={12} /> Refresh expired
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remove expired trace flags"
            onClick={cfg.removeExpired}
            className="h-6 cursor-pointer gap-1 px-1.5 text-[11px]"
          >
            <Eraser size={12} /> Remove expired
          </Button>
        </div>
      </div>
      <table className="w-full text-[11px]">
        <thead className="text-text-dim">
          <tr className="border-b border-border">
            <th className="px-2 py-0.5 text-left font-normal">Type</th>
            <th className="px-2 py-0.5 text-left font-normal">Traced Entity</th>
            <th className="px-2 py-0.5 text-left font-normal">Created By</th>
            <th className="px-2 py-0.5 text-left font-normal">Start Date</th>
            <th className="px-2 py-0.5 text-left font-normal">Expiration Date</th>
            <th className="px-2 py-0.5 text-left font-normal">Debug Level</th>
            <th className="w-7" />
          </tr>
        </thead>
        <tbody>
          {cfg.flags.map((r) => {
            const expired = isExpired(r.expirationDate);
            return (
              <tr key={r._key} className="border-b border-border/60">
                <td className="px-2 py-0.5">
                  {r.id ? (
                    // LogType is set at creation and is NOT updatable on existing flags.
                    <span className="whitespace-nowrap text-foreground">{typeLabel(r.logType)}</span>
                  ) : (
                    <select
                      aria-label="Log type"
                      className={`${SEL} w-32`}
                      value={r.logType}
                      onChange={(e) => cfg.updateFlag(r._key, { logType: e.target.value })}
                    >
                      {LOG_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {typeLabel(t)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-0.5">
                  {r.id ? (
                    <span className="text-foreground">{r.tracedEntityName}</span>
                  ) : (
                    <select
                      aria-label="Traced entity"
                      className={`${SEL} w-64`}
                      value={r.tracedEntityId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const ent = cfg.entities.find((x) => x.id === id);
                        cfg.updateFlag(r._key, {
                          tracedEntityId: id,
                          tracedEntityName: ent?.name ?? id,
                          tracedEntityKind: ent?.kind ?? "User",
                          logType: defaultLogType(ent?.kind ?? "User"),
                        });
                      }}
                    >
                      <option value="" disabled>
                        Select user / class / trigger
                      </option>
                      {cfg.entities.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.name} · {ent.kind}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-0.5 text-text-dim">{r.creatorName || "—"}</td>
                <td className="px-2 py-0.5">
                  <Input
                    aria-label="Start date"
                    value={r.startDate ?? ""}
                    onChange={(e) => cfg.updateFlag(r._key, { startDate: e.target.value })}
                    placeholder="—"
                    className="h-6 w-48 text-[11px]"
                  />
                </td>
                <td className="px-2 py-0.5">
                  <Input
                    aria-label="Expiration date"
                    value={r.expirationDate ?? ""}
                    onChange={(e) => cfg.updateFlag(r._key, { expirationDate: e.target.value })}
                    className={`h-6 w-48 text-[11px] ${expired ? "text-destructive" : ""}`}
                  />
                </td>
                <td className="px-2 py-0.5">
                  <select
                    aria-label="Debug level"
                    className={`${SEL} w-40`}
                    value={r.debugLevelKey}
                    onChange={(e) => cfg.updateFlag(r._key, { debugLevelKey: e.target.value })}
                  >
                    <option value="" disabled>
                      Select level
                    </option>
                    {cfg.levels.map((l) => (
                      <option key={l._key} value={l._key}>
                        {l.developerName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove trace flag"
                    onClick={() => cfg.removeFlag(r._key)}
                    className="size-6 cursor-pointer text-text-dim hover:text-destructive"
                  >
                    <Trash2 size={12} />
                  </Button>
                </td>
              </tr>
            );
          })}
          {cfg.flags.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-3 text-center text-text-dim">
                — no trace flags —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
