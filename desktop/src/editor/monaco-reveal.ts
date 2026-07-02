import { useEffect, useRef, type RefObject } from "react";
import type { editor } from "monaco-editor";

export interface Reveal {
  line: number;
  /** Bumped on every request so re-revealing the same line still fires. */
  nonce: number;
}

/**
 * Scrolls the editor to `reveal.line` whenever the nonce changes. If the
 * editor isn't mounted yet (e.g. a tab just switched), the request is stashed
 * and applied from `flushPending()`, which the caller invokes in `onMount`.
 */
export function useMonacoReveal(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  reveal: Reveal | undefined,
) {
  const pending = useRef<number | null>(null);

  const apply = (line: number) => {
    const ed = editorRef.current;
    if (!ed) {
      pending.current = line;
      return;
    }
    // Defer so the editor has laid out (revealing right at mount is a no-op).
    setTimeout(() => {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }, 0);
  };

  useEffect(() => {
    if (reveal) apply(reveal.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  return {
    flushPending: () => {
      if (pending.current != null) {
        const line = pending.current;
        pending.current = null;
        apply(line);
      }
    },
  };
}
