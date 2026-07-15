/** Inputs opt into the Cmd/Ctrl+F shortcut by carrying `data-uf-search` — put it
 * on the input itself (astryx `TextInput` forwards unknown props through to it). */
const SEARCH = "[data-uf-search]";

/** `offsetParent` is null for position:fixed elements even when they're on
 * screen; client rects are not. */
const onScreen = (el: HTMLElement) => el.getClientRects().length > 0;

let lastPointerDown: HTMLElement | null = null;

/** Track where the user last clicked. Panes of plain text (the raw log, a result
 * table) take no focus when clicked — `activeElement` stays `<body>` — so focus
 * alone can't say which pane the user is in. Call once; returns a disposer. */
export function trackSearchOrigin(): () => void {
  const on = (e: PointerEvent) => {
    lastPointerDown = e.target as HTMLElement;
  };
  window.addEventListener("pointerdown", on, true);
  return () => window.removeEventListener("pointerdown", on, true);
}

/** The pane the user is in: whatever holds focus, else wherever they last
 * clicked. Focus wins so that tabbing to an input still works. */
function origin(): HTMLElement {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) return active;
  return lastPointerDown ?? document.body;
}

/** Focus the search box for whatever the user is looking at: walk up from the
 * origin and take the first visible one in scope. The walk ends at `<body>`, so
 * with no origin this picks the first visible search box anywhere. Returns false
 * when there is none, leaving the key to its default.
 *
 * Behaviour is pinned by e2e/focus-search.spec.ts, which drives real focus and
 * a real Monaco editor — neither survives a jsdom unit test. */
// fallow-ignore-next-line complexity
export function focusSearch(): boolean {
  const from = origin();
  // Monaco ships its own find widget; never take Cmd+F away from it. Only while
  // it's on screen though: switching panels by keyboard leaves focus parked in
  // the hidden editor, and the new pane's filter should still be reachable.
  const editor = from.closest<HTMLElement>(".monaco-editor");
  if (editor && onScreen(editor)) return false;

  // No modal guard needed: dialogs here are native `<dialog>` opened with
  // showModal(), which makes everything behind them inert — focus() on a
  // background filter is already a no-op.
  let node: HTMLElement | null = from;
  for (; node; node = node.parentElement) {
    const hit = [...node.querySelectorAll<HTMLInputElement>(SEARCH)].find(onScreen);
    if (hit) {
      hit.focus();
      hit.select();
      return true;
    }
  }
  return false;
}
