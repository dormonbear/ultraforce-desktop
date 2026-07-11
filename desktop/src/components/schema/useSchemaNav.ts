/** A navigation target for the schema browser: an object, optionally a field. */
export interface SchemaNavTarget {
  object: string;
  field?: string;
}

type Listener = (target: SchemaNavTarget) => void;

// Plain module-level pub/sub — deliberately no state library. The schema panel
// subscribes while mounted; other tools (e.g. the command palette) call
// navigateTo to jump straight to an object/field.
const listeners = new Set<Listener>();

/** Notify every subscriber to navigate to the given object/field. */
export function navigateTo(target: SchemaNavTarget): void {
  for (const listener of listeners) listener(target);
}

/** Subscribe to navigation events. Returns an unsubscribe function. */
export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
