import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { SchemaObject, SchemaObjectDetail } from "../../types";
import { getSchemaObjectDetail, listSchemaObjects } from "../../ipc/schema";
import { formatIpcError } from "../../errorFormat";
import { ObjectList } from "./ObjectList";
import { FieldTable } from "./FieldTable";
import { FieldDetail } from "./FieldDetail";
import { subscribe, type SchemaNavTarget } from "./useSchemaNav";

const HANDLE_CLASS =
  "w-px bg-line transition-colors data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary";

/** Whether an IPC rejection carries the backend's `no-index` error code. */
function isNoIndex(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "no-index"
  );
}

/**
 * Schema tab: a three-pane offline browser over an org's cached schema index —
 * objects (left), the selected object's fields (middle), and full field / record
 * type detail (right). Reads the same index the SOQL/Apex tooling builds; it
 * never triggers indexing itself.
 */
export function SchemaPanel({ org }: { org: string | null }) {
  const [objects, setObjects] = useState<SchemaObject[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [noIndex, setNoIndex] = useState(false);
  const [detailCache, setDetailCache] = useState<Map<string, SchemaObjectDetail>>(
    new Map(),
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [objectFilter, setObjectFilter] = useState("");
  const [fieldFilter, setFieldFilter] = useState("");
  // Bumped on every object click so re-selecting an object whose detail fetch
  // failed retries it (cache hits still early-return, so this is free).
  const [fetchNonce, setFetchNonce] = useState(0);

  // Load the object list whenever the active org changes. The detail cache is
  // per-org (object names collide across orgs), so drop it too.
  useEffect(() => {
    setDetailCache(new Map());
    if (!org) {
      setObjects([]);
      setNoIndex(false);
      return;
    }
    let cancelled = false;
    setObjectsLoading(true);
    setNoIndex(false);
    setSelectedObject(null);
    setSelectedField(null);
    listSchemaObjects(org)
      .then((list) => {
        if (cancelled) return;
        setObjects(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setObjects([]);
        if (isNoIndex(e)) {
          setNoIndex(true);
        } else {
          toast.error(`Schema: ${formatIpcError(e)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setObjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  // Load (and cache) the detail for the selected object.
  useEffect(() => {
    if (!org || !selectedObject || detailCache.has(selectedObject)) return;
    let cancelled = false;
    setDetailLoading(true);
    getSchemaObjectDetail(org, selectedObject)
      .then((detail) => {
        if (cancelled) return;
        setDetailCache((prev) => new Map(prev).set(detail.name, detail));
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(`Schema: ${formatIpcError(e)}`);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, selectedObject, detailCache, fetchNonce]);

  // External navigation (command palette, links) — jump to object/field and
  // clear filters so the target is visible.
  useEffect(() => {
    return subscribe((t: SchemaNavTarget) => {
      setSelectedObject(t.object);
      setSelectedField(t.field ?? null);
      setObjectFilter("");
      setFieldFilter("");
    });
  }, []);

  const onSelectObject = useCallback((name: string) => {
    setSelectedObject(name);
    setSelectedField(null);
    setFetchNonce((n) => n + 1);
  }, []);

  const detail = selectedObject ? detailCache.get(selectedObject) : undefined;
  const fields = detail?.fields ?? [];
  const activeField = useMemo(
    () => fields.find((f) => f.name === selectedField) ?? null,
    [fields, selectedField],
  );
  const detailPaneLoading = Boolean(selectedObject) && !detail && detailLoading;

  if (org && noIndex) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[13px] font-medium text-foreground">
          This org isn’t indexed yet
        </div>
        <div className="max-w-sm text-[12px] text-muted-foreground">
          Use the “Reindex org” button in the top toolbar to build the schema
          index, then reopen this tab.
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel id="schema-objects" defaultSize="240px" minSize="160px">
        <ObjectList
          objects={objects}
          selected={selectedObject}
          filter={objectFilter}
          onFilterChange={setObjectFilter}
          onSelect={onSelectObject}
        />
      </ResizablePanel>
      <ResizableHandle className={HANDLE_CLASS} />
      <ResizablePanel id="schema-fields" minSize="240px">
        {selectedObject ? (
          <FieldTable
            fields={fields}
            loading={detailPaneLoading}
            selected={selectedField}
            filter={fieldFilter}
            onFilterChange={setFieldFilter}
            onSelect={setSelectedField}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
            {objectsLoading
              ? "Loading objects…"
              : "Select an object to browse its fields."}
          </div>
        )}
      </ResizablePanel>
      <ResizableHandle className={HANDLE_CLASS} />
      <ResizablePanel id="schema-detail" defaultSize="320px" minSize="220px">
        <FieldDetail
          objectName={selectedObject}
          field={activeField}
          recordTypes={detail?.recordTypes ?? []}
          onClose={() => setSelectedField(null)}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
