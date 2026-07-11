import type { SchemaField, SchemaObject } from "../../types";

/** Case-insensitive substring match against any of the given haystacks. */
function matches(needle: string, ...haystacks: string[]): boolean {
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/** Filter objects by API name or label. Empty/blank query returns all. */
export function filterObjects(objects: SchemaObject[], q: string): SchemaObject[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return objects;
  return objects.filter((o) => matches(needle, o.name, o.label));
}

/** Filter fields by API name or label. Empty/blank query returns all. */
export function filterFields(fields: SchemaField[], q: string): SchemaField[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return fields;
  return fields.filter((f) => matches(needle, f.name, f.label));
}
