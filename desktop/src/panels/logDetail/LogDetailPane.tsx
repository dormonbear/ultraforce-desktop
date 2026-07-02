import { Bug } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LogView } from "../../components/LogView";
import { LogoLoader } from "../../components/LogoLoader";
import { TimelineView } from "../TimelineView";
import { TimeBreakdownBar } from "../TimeBreakdownBar";
import { sourceAtLine } from "../../ipc/logs";
import type { SourceRef } from "../sourceRef";
import type { LogViewDto } from "../../types";
import { InsightsView } from "./InsightsView";
import { LimitsView } from "./LimitsView";
import { HotspotsView } from "./HotspotsView";
import { QueriesView } from "./QueriesView";
import type { DetailTab } from "./types";

/** Right-hand detail pane: header, tab switcher, and the selected log's raw /
 * timeline / analysis views. Purely presentational — all state comes in. */
// fallow-ignore-next-line complexity
export function LogDetailPane({
  selectedId,
  view,
  viewLoading,
  viewError,
  orgless,
  tab,
  setTab,
  sourceLines,
  onSource,
  onOpenDebug,
}: {
  selectedId: string | null;
  view: LogViewDto | null;
  viewLoading: boolean;
  viewError: string | null;
  orgless: boolean;
  tab: DetailTab;
  setTab: (tab: DetailTab) => void;
  sourceLines: Set<number>;
  onSource: (ref: SourceRef) => void;
  onOpenDebug: () => void;
}) {
  return (
    <>
      <div className="micro-label px-4 py-2">
        Log detail
        {orgless && (
          <span className="text-[11px] font-normal text-text-dim/70">
            · local file (no org — source navigation off)
          </span>
        )}
      </div>

      {!selectedId && !view && !viewLoading && !viewError ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
          Select a log
        </div>
      ) : viewLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <LogoLoader size={44} />
        </div>
      ) : viewError ? (
        <pre className="select-text mx-4 mb-4 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-card p-3 text-[12px] text-destructive">
          {viewError}
        </pre>
      ) : view ? (
        <div className="select-text flex min-h-0 flex-1 flex-col px-4 pb-4">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="tnum text-[12px] text-text-dim">
                API {view.apiVersion ?? "—"} · {view.units.length}{" "}
                {view.units.length === 1 ? "unit" : "units"}
              </div>
              <button
                type="button"
                onClick={onOpenDebug}
                className="focus-accent flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Bug size={13} /> Debug
              </button>
            </div>
            <ToggleGroup
              type="single"
              value={tab}
              onValueChange={(next) => {
                if (next) setTab(next as DetailTab);
              }}
              className="gap-1"
            >
              {([
                "raw",
                "insights",
                "timeline",
                "hotspots",
                "queries",
                "limits",
              ] as DetailTab[]).map((t) => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className="focus-accent h-auto cursor-pointer rounded-md px-2 py-0.5 text-[11px] font-medium capitalize text-text-dim hover:text-foreground data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
                >
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {tab === "raw" || tab === "timeline" ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
              {tab === "raw" ? (
                <LogView
                  raw={view.raw}
                  resolveSource={(line) => sourceAtLine(view.raw, line)}
                  onSource={onSource}
                  jumpableLines={sourceLines}
                />
              ) : (
                <TimelineView units={view.units} onSource={orgless ? undefined : onSource} />
              )}
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-card">
              <div className="p-3">
              <TimeBreakdownBar units={view.units} />
              {tab === "insights" ? (
                <InsightsView units={view.units} onGoto={setTab} />
              ) : tab === "hotspots" ? (
                <HotspotsView units={view.units} onSource={orgless ? undefined : onSource} />
              ) : tab === "queries" ? (
                <QueriesView units={view.units} />
              ) : (
                <LimitsView units={view.units} />
              )}
              </div>
            </ScrollArea>
          )}
        </div>
      ) : null}
    </>
  );
}
