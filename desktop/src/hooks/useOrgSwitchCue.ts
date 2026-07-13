import { useArrivalCue } from "./useArrivalCue";

/**
 * One-shot cue nonce for a *real* active-org change. Increments exactly once
 * each time the selected org username transitions from one org to a different
 * one — never for the initial `null → org` hydration (a cold start the plan
 * never asked to echo), never for a reconnect/re-select of the same org, and
 * never for unrelated re-renders (poll ticks, config saves, mount storms). A
 * remount with an org already selected is silent too. Feed the nonce as a React
 * `key` to the titlebar Aurora-echo elements so the effect replays once per
 * switch.
 *
 * This is a pure observer of `selected`; it never gates, awaits, or delays the
 * switch itself (that ordering lives in `org.tsx`). It is a thin, intent-named
 * wrapper over `useArrivalCue` (with `requirePrevToken` so a previous non-null
 * org is required before firing) whose string identity is exactly the org edge.
 */
export function useOrgSwitchCue(selected: string | null): number {
  return useArrivalCue(selected, true);
}
