import { formatIpcError } from "../errorFormat";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useOrgs } from "../org";
import { getNamespacePolicy } from "../indexSettings";
import { reindexOrg } from "../ipc/schema";
import { useIndexProgress } from "./IndexProgress";

/**
 * Rebuilds the cached offline sObject schema for the active org. The schema
 * cache otherwise only refreshes on a miss, so this is the manual escape hatch
 * after metadata changes in the org.
 */
export function SchemaRefresh() {
  const { selected: org } = useOrgs();
  const [busy, setBusy] = useState(false);
  // The top-bar progress pill already owns the indexing spinner. Suppress this
  // button's own spinner and disable it whenever an index is running — whether
  // this button kicked it off (`busy`) or it was triggered elsewhere (the
  // `index-progress` stream) — so users see one spinner and can't double-fire.
  const indexing = useIndexProgress() !== null;

  const refresh = async () => {
    if (!org) {
      toast.error("No org selected");
      return;
    }
    setBusy(true);
    try {
      await reindexOrg(org, await getNamespacePolicy());
      toast.success("Reindexing org...");
    } catch (e) {
      toast.error(`Schema refresh failed: ${formatIpcError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <IconButton
      label="Reindex org"
      tooltip="Reindex org"
      variant="ghost"
      size="sm"
      icon={<RefreshCw size={15} />}
      isDisabled={busy || indexing}
      onClick={() => void refresh()}
    />
  );
}
