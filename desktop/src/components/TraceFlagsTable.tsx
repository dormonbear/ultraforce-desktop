import { Plus, Trash2, RefreshCw, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isExpired } from "../traceTime";
import type { useLoggingConfig } from "../useLoggingConfig";

type Cfg = ReturnType<typeof useLoggingConfig>;

const LOG_TYPES = ["USER_DEBUG", "CLASS_TRACING", "DEVELOPER_LOG"] as const;

function defaultLogType(kind: string): string {
  return kind === "ApexClass" || kind === "ApexTrigger" ? "CLASS_TRACING" : "USER_DEBUG";
}

/** Editable table of TraceFlag records across users / classes / triggers. */
export function TraceFlagsTable({ cfg }: { cfg: Cfg }) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
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
      <table className="w-full text-[12px]">
        <thead className="text-text-dim">
          <tr className="border-b border-border">
            <th className="px-2 py-1 text-left font-normal">Type</th>
            <th className="px-2 py-1 text-left font-normal">Traced Entity</th>
            <th className="px-2 py-1 text-left font-normal">Creator</th>
            <th className="px-2 py-1 text-left font-normal">Expiration</th>
            <th className="px-2 py-1 text-left font-normal">Debug Level</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {cfg.flags.map((r) => {
            const expired = isExpired(r.expirationDate);
            return (
              <tr key={r._key} className="border-b border-border/60">
                <td className="px-2 py-1">
                  <Select
                    value={r.logType || undefined}
                    onValueChange={(v) => cfg.updateFlag(r._key, { logType: v })}
                  >
                    <SelectTrigger aria-label="Log type" className="h-7 w-36 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOG_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1">
                  {r.id ? (
                    <span className="text-foreground">{r.tracedEntityName}</span>
                  ) : (
                    <Select
                      value={r.tracedEntityId || undefined}
                      onValueChange={(id) => {
                        const e = cfg.entities.find((x) => x.id === id);
                        cfg.updateFlag(r._key, {
                          tracedEntityId: id,
                          tracedEntityName: e?.name ?? id,
                          tracedEntityKind: e?.kind ?? "User",
                          logType: defaultLogType(e?.kind ?? "User"),
                        });
                      }}
                    >
                      <SelectTrigger aria-label="Traced entity" className="h-7 w-56 text-[12px]">
                        <SelectValue placeholder="Select user / class / trigger" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {cfg.entities.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name} · {e.kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-2 py-1 text-text-dim">{r.creatorName || "—"}</td>
                <td className="px-2 py-1">
                  <Input
                    aria-label="Expiration date"
                    value={r.expirationDate ?? ""}
                    onChange={(e) => cfg.updateFlag(r._key, { expirationDate: e.target.value })}
                    className={`h-7 w-52 text-[11px] ${expired ? "text-destructive" : ""}`}
                  />
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={r.debugLevelKey || undefined}
                    onValueChange={(key) => cfg.updateFlag(r._key, { debugLevelKey: key })}
                  >
                    <SelectTrigger aria-label="Debug level" className="h-7 w-44 text-[12px]">
                      <SelectValue placeholder="Select level" />
                    </SelectTrigger>
                    <SelectContent>
                      {cfg.levels.map((l) => (
                        <SelectItem key={l._key} value={l._key}>
                          {l.developerName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-1 py-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove trace flag"
                    onClick={() => cfg.removeFlag(r._key)}
                    className="size-7 cursor-pointer text-text-dim hover:text-destructive"
                  >
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            );
          })}
          {cfg.flags.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-3 text-center text-text-dim">
                — no trace flags —
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
