import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { RecordDto, FieldDto } from "../types";

/** Stable key for a record row: its Id field if present, else type+position. */
function recordKey(record: RecordDto, fallback: number): string {
  const id = record.fields.find(
    (f) => f.name.toLowerCase() === "id" && f.value.kind === "scalar"
  );
  return id?.value.scalar ?? `${record.sobject_type}-${fallback}`;
}

function FieldRow({ field, depth }: { field: FieldDto; depth: number }) {
  const [open, setOpen] = useState(false);
  const pad = { paddingLeft: `${depth * 14 + 12}px` };
  const v = field.value;

  if (v.kind === "parent" && v.parent) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="focus-accent flex w-full cursor-pointer items-center gap-1 py-0.5 text-left hover:bg-accent/30"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-foreground">{field.name}</span>
          <span className="text-muted-foreground">{v.parent.sobject_type}</span>
        </button>
        {open && <RecordNode record={v.parent} depth={depth + 1} />}
      </>
    );
  }
  if (v.kind === "children" && v.children) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="focus-accent flex w-full cursor-pointer items-center gap-1 py-0.5 text-left hover:bg-accent/30"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="text-foreground">{field.name}</span>
          <span className="text-muted-foreground tnum">[{v.children.length}]</span>
        </button>
        {open &&
          v.children.map((c, i) => (
            <RecordNode key={recordKey(c, i)} record={c} depth={depth + 1} />
          ))}
      </>
    );
  }
  return (
    <div style={pad} className="flex gap-2 py-0.5">
      <span className="text-text-dim">{field.name}</span>
      <span className="tnum text-foreground">
        {v.kind === "null" ? <span className="text-muted-foreground">null</span> : v.scalar}
      </span>
    </div>
  );
}

function RecordNode({ record, depth }: { record: RecordDto; depth: number }) {
  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
        className="micro-label py-0.5"
      >
        {record.sobject_type}
      </div>
      {record.fields.map((f) => (
        <FieldRow key={f.name} field={f} depth={depth + 1} />
      ))}
    </div>
  );
}

/** Expandable parent/child record tree for a SOQL result. */
export function RecordTree({ records }: { records: RecordDto[] }) {
  if (records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        No rows
      </div>
    );
  }
  return (
    <div className="select-text h-full overflow-auto py-1 text-[12px]">
      {records.map((r, i) => (
        <RecordNode key={recordKey(r, i)} record={r} depth={0} />
      ))}
    </div>
  );
}
