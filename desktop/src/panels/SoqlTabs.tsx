import { FileTabsPanel } from "../tabs/FileTabsPanel";
import { basename } from "../fs/paths";
import { SoqlView } from "./SoqlPanel";
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

export function SoqlTabs() {
  return (
    <FileTabsPanel<SoqlTab>
      tool="soql"
      ext="soql"
      contentKey="query"
      make={makeSoqlTab}
      ariaLabel="SOQL tabs"
      emptyHint="Open a query from the sidebar"
      newLabel="New query"
      renderView={(a) => <SoqlView key={a.tab.id} {...a} />}
    />
  );
}
