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
 * The mount token NEVER fires: the hook starts armed-but-silent (nonce 0) with
 * the mount token already recorded as "seen". Only a genuine *post-mount*
 * identity edge to a non-null token increments. This is what keeps a remount
 * with an already-present result (e.g. a SOQL tab switch that re-mounts the view
 * over an existing result) from replaying the arrival cue.
 *
 * `requirePrevToken` additionally suppresses the first `null → token` adoption:
 * the cue only fires once a *previous* non-null token has been observed. Org
 * switching uses this so the cold-start hydration is silent and only real
 * org→org switches echo (see {@link useOrgSwitchCue}).
 *
 * Updating state during render is the sanctioned React pattern for deriving
 * state from a changed prop; the ref guard makes it idempotent under
 * StrictMode's double invocation.
 */
export function useArrivalCue(token: unknown, requirePrevToken = false): number {
  const [nonce, setNonce] = useState(0);
  const prev = useRef(token);
  if (token !== prev.current) {
    const hadToken = prev.current != null;
    prev.current = token;
    if (token != null && (!requirePrevToken || hadToken)) setNonce((n) => n + 1);
  }
  return nonce;
}
