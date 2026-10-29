import { memo } from "react";
import { FileTabsPanel } from "../tabs/FileTabsPanel";
import { basename } from "../fs/paths";
import { ApexView } from "./ApexPanel";
import { useI18n } from "../i18n";
import type { ApexTab } from "../tabs/types";

const makeApexTab = (path: string, content: string): ApexTab => ({
  id: crypto.randomUUID(),
  path,
  title: basename(path),
  src: content,
  outcome: null,
  error: null,
  traceOpen: false,
});

export const ApexTabs = memo(function ApexTabs() {
  const { t } = useI18n();
  return (
    <FileTabsPanel<ApexTab>
      tool="apex"
      ext="apex"
      contentKey="src"
      make={makeApexTab}
      ariaLabel={t("Apex tabs")}
      emptyHint={t("Open a script from the sidebar")}
      newLabel={t("New script")}
      renderView={(a) => <ApexView key={a.tab.id} {...a} />}
    />
  );
});
