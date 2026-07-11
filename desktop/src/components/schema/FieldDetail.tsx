import { X } from "lucide-react";
import type { SchemaField, SchemaRecordType } from "../../types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {field.picklistValues.map((p) => (
                <TableRow key={p.value}>
                  <TableCell>{p.label}</TableCell>
                  <TableCell className="font-mono text-[11px]">{p.value}</TableCell>
                  <TableCell>{p.active ? "Yes" : "No"}</TableCell>
                  <TableCell>{p.defaultValue ? "Yes" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
export function FieldDetail({
  objectName,
  field,
  recordTypes,
  onClose,
}: {
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
          <FieldView field={field} />
        ) : (
          <RecordTypesView recordTypes={recordTypes} />
        )}
      </div>
    </div>
  );
}
