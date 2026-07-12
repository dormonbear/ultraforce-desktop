import { memo } from "react";
import { FileTabsPanel } from "../tabs/FileTabsPanel";
import { basename } from "../fs/paths";
import { ApexView } from "./ApexPanel";
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
  return (
    <FileTabsPanel<ApexTab>
      tool="apex"
      ext="apex"
      contentKey="src"
      make={makeApexTab}
      ariaLabel="Apex tabs"
      emptyHint="Open a script from the sidebar"
      newLabel="New script"
      renderView={(a) => <ApexView key={a.tab.id} {...a} />}
    />
  );
});
