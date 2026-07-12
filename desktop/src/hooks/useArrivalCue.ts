import { useRef, useState } from "react";

/**
 * One-shot "arrival" trigger. Returns a nonce that increments exactly once each
 * time `token` transitions to a new, cue-worthy identity — a state edge, not a
 * render count. Feed the nonce as a React `key` to a one-shot animation element
 * so the cue replays once per arrival and never re-fires on unrelated
 * re-renders (scroll, sort, filter, progress ticks).
 *
 * `token` is the stable identity of the current arrival (e.g. a result object
 * reference), or `null`/`undefined` when there is nothing to cue. Passing the
 * same token across renders does not re-fire; passing `null` (cancel/error)
 * arms the next real arrival without emitting a cue.
 *
 * The initial nonce reflects the mount-time token so the first result — which
 * mounts the consumer fresh — still fires. Updating state during render is the
 * sanctioned React pattern for deriving state from a changed prop; the ref
 * guard makes it idempotent under StrictMode's double invocation.
 */
export function useArrivalCue(token: unknown): number {
  const [nonce, setNonce] = useState(() => (token == null ? 0 : 1));
  const prev = useRef(token);
  if (token !== prev.current) {
    prev.current = token;
    if (token != null) setNonce((n) => n + 1);
  }
  return nonce;
}
