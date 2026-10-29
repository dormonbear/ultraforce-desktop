import { memo } from "react";
import { FileTabsPanel } from "../tabs/FileTabsPanel";
import { basename } from "../fs/paths";
import { SoqlView } from "./SoqlPanel";
import { useI18n } from "../i18n";
import type { SoqlTab } from "../tabs/types";

const makeSoqlTab = (path: string, content: string): SoqlTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  query: content,
  result: null,
  error: null,
  useToolingApi: false,
  allRows: false,
  plan: null,
});

export const SoqlTabs = memo(function SoqlTabs() {
  const { t } = useI18n();
  return (
    <FileTabsPanel<SoqlTab>
      tool="soql"
      ext="soql"
      contentKey="query"
      make={makeSoqlTab}
      ariaLabel={t("SOQL tabs")}
      emptyHint={t("Open a query from the sidebar")}
      newLabel={t("New query")}
      renderView={(a) => <SoqlView key={a.tab.id} {...a} />}
    />
  );
});
