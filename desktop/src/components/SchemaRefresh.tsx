import { formatIpcError } from "../errorFormat";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useOrgs } from "../org";
import { getNamespacePolicy } from "../indexSettings";
import { reindexOrg } from "../ipc/schema";
import { useIndexProgress } from "./IndexProgress";
import { browserLocale, translate, useI18n } from "../i18n";

/**
 * Rebuilds the cached offline sObject schema for the active org. The schema
 * cache otherwise only refreshes on a miss, so this is the manual escape hatch
 * after metadata changes in the org.
 */
export function SchemaRefresh() {
  const { t } = useI18n();
  const { selected: org } = useOrgs();
  const [busy, setBusy] = useState(false);
  // The top-bar progress pill already shows the indexing spinner + phase. Hide
  // this button entirely while an index is running — whether this button kicked
  // it off (`busy`) or it was triggered elsewhere (the `index-progress` stream)
  // — so the pill is the only indicator and the button can't be double-fired.
  const indexing = useIndexProgress() !== null;

  const refresh = async () => {
    if (!org) {
      toast.error(t("No org selected"));
      return;
    }
    setBusy(true);
    try {
      await reindexOrg(org, await getNamespacePolicy());
      toast.success(translate(browserLocale(), "Reindexing org…"));
    } catch (e) {
      toast.error(translate(browserLocale(), "Schema refresh failed: {error}", { error: formatIpcError(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (busy || indexing) return null;

  return (
    <IconButton
      label={t("Reindex org")}
      tooltip={t("Reindex org")}
      variant="ghost"
      size="sm"
      icon={<RefreshCw size={15} />}
      onClick={() => void refresh()}
    />
  );
}
