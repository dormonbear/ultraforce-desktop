import { lazy, Suspense, useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { EditorProps } from "@monaco-editor/react";
import { useI18n } from "../i18n";

const BundledEditor = lazy(async () => {
  const { initializeLocalMonaco } = await import("./monaco-local");
  await initializeLocalMonaco();
  return import("@monaco-editor/react");
});

/** Load the bundled editor on first use, after configuring its local loader. */
export default function LocalEditor(props: EditorProps) {
  const { t } = useI18n();
  const onChangeRef = useRef(props.onChange);
  const onMountRef = useRef(props.onMount);
  useLayoutEffect(() => {
    onChangeRef.current = props.onChange;
    onMountRef.current = props.onMount;
  }, [props.onChange, props.onMount]);
  const onChange = useCallback<NonNullable<EditorProps["onChange"]>>((value, event) => {
    const change = onChangeRef.current;
    if (!change) return;
    // Monaco emits outside React; commit before another edit can arrive and an old value can replay. / Monaco 在 React 外触发变更，须在下一次编辑前提交，避免旧值重放。
    flushSync(() => change(value, event));
  }, []);
  const onMount = useCallback<NonNullable<EditorProps["onMount"]>>((instance, monaco) => {
    const active = document.activeElement;
    const tabFocus = active instanceof HTMLElement && active.closest('[role="tablist"]') ? active : null;
    onMountRef.current?.(instance, monaco);
    // A late editor initializer must preserve the user's tab-list focus. / 迟到的编辑器初始化必须保留用户的标签栏焦点。
    if (tabFocus?.isConnected) tabFocus.focus();
  }, []);
  return (
    <Suspense fallback={<div role="status">{t("Loading editor…")}</div>}>
      <BundledEditor {...props} onChange={props.onChange ? onChange : undefined} onMount={props.onMount ? onMount : undefined} />
    </Suspense>
  );
}
