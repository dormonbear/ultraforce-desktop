import { useArrivalCue } from "./useArrivalCue";

/**
 * One-shot cue nonce for a *real* active-org change. Increments exactly once
 * each time the selected org username transitions to a new value — the initial
 * `null → org` adoption and every `org → other-org` switch — and never for a
 * reconnect/re-select of the same org, nor for unrelated re-renders (poll
 * ticks, config saves, mount storms). Feed the nonce as a React `key` to the
 * titlebar Aurora-echo elements so the effect replays once per switch.
 *
 * This is a pure observer of `selected`; it never gates, awaits, or delays the
 * switch itself (that ordering lives in `org.tsx`). It is a thin, intent-named
 * wrapper over `useArrivalCue` whose string identity is exactly the org edge.
 */
export function useOrgSwitchCue(selected: string | null): number {
  return useArrivalCue(selected);
}
