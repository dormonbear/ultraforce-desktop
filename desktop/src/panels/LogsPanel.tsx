import { memo, useCallback, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { formatIpcError } from "../errorFormat";
import { SourceDialog } from "../components/SourceDialog";
import { LogDebugger } from "../components/LogDebugger";
import { LoggingConfigPanel } from "../components/LoggingConfigPanel";
import { useOrgs } from "../org";
import { LogListPane } from "./LogListPane";
import { LogDetailPane } from "./logDetail/LogDetailPane";
import { useLogList } from "./useLogList";
import { useLogView } from "./useLogView";
import { useSelfTrace } from "./useSelfTrace";
import { useLogDragDrop } from "./useLogDragDrop";
import type { LogRefDto } from "../types";

/** Debug Logs: a refreshable list on the left, selected log's raw view right.
 * `isActive` is whether Logs is the visible tool; forwarded to `useSelfTrace`
 * so its 30s countdown tick pauses while the panel is hidden. */
export const LogsPanel = memo(function LogsPanel({ isActive }: { isActive: boolean }) {
  const { selected: org } = useOrgs();
  const [cfgOpen, setCfgOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const {
    selectedId,
    view,
    viewError,
    viewLoading,
    sourceLines,
    tab,
    setTab,
    orgless,
    sourceRef,
    setSourceRef,
    cachedIds,
    select,
    showLocalLog,
    getBody,
    resetForOrg,
    clearViewCache,
  } = useLogView(org);

  const { logs, visibleLogs, listError, listLoading, filter, setFilter, refresh } =
    useLogList(org, resetForOrg, clearViewCache);

  const trace = useSelfTrace(org, isActive);
  const dragOver = useLogDragDrop(showLocalLog);

  const selectRow = useCallback(
    (id: string) => {
      setCfgOpen(false);
      void select(id);
    },
    [select],
  );

  /** Save one log row's body to disk, via a right-click context menu. */
  const saveLogRow = useCallback(async (log: LogRefDto) => {
    try {
      const body = await getBody(log);
      const path = await saveDialog({
        defaultPath: `${log.operation || "debug"}.log`,
        filters: [{ name: "Debug log", extensions: ["log"] }],
      });
      if (!path) return;
      await writeTextFile(path, body);
      toast.success("Log saved");
    } catch (e) {
      toast.error(`Save failed: ${formatIpcError(e)}`);
    }
  }, [getBody]);

  return (
    <ResizablePanelGroup direction="horizontal">
      {/* minSize = the natural width of the header toolbar (LOGS · REFRESH ·
          LOGGING) so those buttons never clip.
          NOTE: this resizable lib wants string px/% sizes, not bare numbers. */}
      <ResizablePanel
        defaultSize="40%"
        minSize="450px"
        groupResizeBehavior="preserve-pixel-size"
      >
        <LogListPane
          logs={logs}
          visibleLogs={visibleLogs}
          listError={listError}
          listLoading={listLoading}
          filter={filter}
          setFilter={setFilter}
          selectedId={selectedId}
          cachedIds={cachedIds}
          dragOver={dragOver}
          trace={trace}
          onRefresh={refresh}
          onOpenConfig={() => setCfgOpen(true)}
          onSelect={selectRow}
          onSaveLog={(log) => void saveLogRow(log)}
        />
      </ResizablePanel>

      <ResizableHandle className="w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary" />

      <ResizablePanel minSize="360px">
        <div className="flex h-full flex-col">
          {cfgOpen ? (
            <LoggingConfigPanel org={org} onClose={() => setCfgOpen(false)} />
          ) : (
            <LogDetailPane
              selectedId={selectedId}
              view={view}
              viewLoading={viewLoading}
              viewError={viewError}
              orgless={orgless}
              tab={tab}
              setTab={setTab}
              sourceLines={sourceLines}
              onSource={setSourceRef}
              onOpenDebug={() => setDebugOpen(true)}
            />
          )}
        </div>
      </ResizablePanel>
      <SourceDialog target={sourceRef} onClose={() => setSourceRef(null)} />
      {view && (
        <LogDebugger
          raw={view.raw}
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </ResizablePanelGroup>
  );
});
