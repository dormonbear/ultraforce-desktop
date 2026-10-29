import { useCallback, useLayoutEffect, useRef } from "react";

type FocusTarget = { id: string } | { path: string };
type Intent = { generation: number; owner: Element | null; target?: FocusTarget };

/** Keep delayed editor focus tied to the interaction that requested it. / 将延迟的编辑器焦点绑定到发起操作。 */
export function useEditorFocusIntent() {
  const generation = useRef(0);
  const intent = useRef<Intent>({
    generation: 0,
    owner: typeof document === "undefined" ? null : document.activeElement,
  });

  useLayoutEffect(() => {
    const onFocus = () => { generation.current += 1; };
    document.addEventListener("focusin", onFocus, true);
    return () => document.removeEventListener("focusin", onFocus, true);
  }, []);

  const capture = useCallback((target?: FocusTarget) => {
    intent.current = { generation: generation.current, owner: document.activeElement, target };
  }, []);

  const allows = useCallback((id: string, path: string) => {
    const request = intent.current;
    const target = request.target;
    if (target && ("id" in target ? target.id !== id : target.path !== path)) return false;
    if (request.generation !== generation.current) return false;
    const active = document.activeElement;
    return active === request.owner || (!!request.owner && !request.owner.isConnected && active === document.body);
  }, []);

  return { capture, allows };
}
