import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X } from "lucide-react";
import type {
  SchemaField,
  SchemaPicklistValue,
  SchemaRecordType,
} from "../../types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ReferencesSection } from "./ReferencesSection";
import { useRemeasureOnVisible } from "./useRemeasureOnVisible";

// Shared 4-column grid template so the header row lines up with the virtualized
// body rows (two separate grids, identical tracks → aligned columns).
const PICKLIST_COLS =
  "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_3.5rem]";
const PICKLIST_ROW_H = 28; // px floor per row (single-line, non-wrapping)
const PICKLIST_MAX_H = 288; // px cap on the bounded scroll region

/**
 * Picklist values as a virtualized, self-bounded region. The full field detail
 * lives in a shared right-pane scroller; a 1000-row `<table>` there ballooned the
 * live DOM (the Step-5 perf hotspot), so this carves out its own bounded-height
 * viewport and renders only the visible rows via `@tanstack/react-virtual` (same
 * pattern as FieldTable/ObjectList). Table markup fights the virtualizer's
 * absolute row positioning, so rows are plain grid divs — the established
 * LogListPane approach.
 */
function PicklistValues({ values }: { values: SchemaPicklistValue[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: values.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => PICKLIST_ROW_H,
    overscan: 12,
  });
  useRemeasureOnVisible(viewportRef, rowVirtualizer);
  // Height tracks content up to a cap: small picklists render flush (no wasted
  // scroll area), large ones bound at PICKLIST_MAX_H and scroll internally.
  const height = Math.min(values.length * PICKLIST_ROW_H, PICKLIST_MAX_H);

  return (
    <div className="rounded border border-border">
      <div
        className={`grid ${PICKLIST_COLS} gap-2 border-b border-border bg-secondary px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        <div>Label</div>
        <div>Value</div>
        <div>Active</div>
        <div>Default</div>
      </div>
      <ScrollArea
        className="uf-scroll"
        style={{ height }}
        viewportRef={viewportRef}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const p = values[vi.index];
            return (
              <div
                key={p.value}
                data-index={vi.index}
                ref={rowVirtualizer.measureElement}
                className={`absolute left-0 top-0 grid w-full ${PICKLIST_COLS} items-center gap-2 whitespace-nowrap px-2 py-1 text-[12px] text-foreground`}
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="truncate">{p.label}</div>
                <div className="truncate font-mono text-[11px]">{p.value}</div>
                <div>{p.active ? "Yes" : "No"}</div>
                <div>{p.defaultValue ? "Yes" : ""}</div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldView({ field }: { field: SchemaField }) {
  const typeLabel =
    field.referenceTo.length > 0
      ? `reference→${field.referenceTo.join(", ")}`
      : field.fieldType;
  return (
    <>
      <Section title="Type">
        <div className="font-mono text-[12px] text-foreground">{typeLabel}</div>
      </Section>
      {field.label && field.label !== field.name && (
        <Section title="Label">
          <div className="text-[12px] text-foreground">{field.label}</div>
        </Section>
      )}
      {field.inlineHelpText && (
        <Section title="Help text">
          <div className="text-[12px] text-foreground">{field.inlineHelpText}</div>
        </Section>
      )}
      {field.calculatedFormula && (
        <Section title="Formula">
          <pre className="uf-scroll overflow-auto rounded border border-border bg-secondary p-2 text-[11px] text-foreground">
            {field.calculatedFormula}
          </pre>
        </Section>
      )}
      {field.picklistValues.length > 0 && (
        <Section title={`Picklist values (${field.picklistValues.length})`}>
          <PicklistValues values={field.picklistValues} />
        </Section>
      )}
    </>
  );
}

function RecordTypesView({ recordTypes }: { recordTypes: SchemaRecordType[] }) {
  if (recordTypes.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        Select a field to see its detail.
      </div>
    );
  }
  return (
    <Section title={`Record types (${recordTypes.length})`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Developer name</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Default</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recordTypes.map((rt) => (
            <TableRow key={rt.developerName}>
              <TableCell>{rt.name}</TableCell>
              <TableCell className="font-mono text-[11px]">
                {rt.developerName}
              </TableCell>
              <TableCell>{rt.active ? "Yes" : "No"}</TableCell>
              <TableCell>{rt.master ? "Yes" : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

/**
 * Right pane of the schema browser. With a field selected it shows the full
 * field detail (help text, formula, picklist values); with none selected it
 * falls back to the object-level record-types section. Visual shape mirrors the
 * result-table DetailPanel (bordered, headered, scrollable body).
 */
export const FieldDetail = memo(function FieldDetail({
  org,
  objectName,
  field,
  recordTypes,
  onClose,
}: {
  org: string | null;
  objectName: string | null;
  field: SchemaField | null;
  recordTypes: SchemaRecordType[];
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col border-l border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
        <div className="min-w-0 truncate text-[12px] font-semibold text-foreground">
          {field ? field.name : (objectName ?? "Detail")}
        </div>
        {field && (
          <button
            type="button"
            aria-label="Close field detail"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="uf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {field ? (
          <>
            <FieldView field={field} />
            <ReferencesSection org={org} object={objectName} field={field} />
          </>
        ) : (
          <RecordTypesView recordTypes={recordTypes} />
        )}
      </div>
    </div>
  );
});
