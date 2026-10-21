import { lazy, Suspense, useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { EditorProps } from "@monaco-editor/react";

const BundledEditor = lazy(async () => {
  const { initializeLocalMonaco } = await import("./monaco-local");
  await initializeLocalMonaco();
  return import("@monaco-editor/react");
});

/** Load the bundled editor on first use, after configuring its local loader. */
export default function LocalEditor(props: EditorProps) {
  const onChangeRef = useRef(props.onChange);
  useLayoutEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);
  const onChange = useCallback<NonNullable<EditorProps["onChange"]>>((value, event) => {
    const change = onChangeRef.current;
    if (!change) return;
    // Monaco emits outside React; commit before another edit can arrive and an old value can replay. / Monaco 在 React 外触发变更，须在下一次编辑前提交，避免旧值重放。
    flushSync(() => change(value, event));
  }, []);
  return (
    <Suspense fallback={<div role="status">Loading editor…</div>}>
      <BundledEditor {...props} onChange={props.onChange ? onChange : undefined} />
    </Suspense>
  );
}
