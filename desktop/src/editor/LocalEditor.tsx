import { lazy, Suspense } from "react";
import type { EditorProps } from "@monaco-editor/react";

const BundledEditor = lazy(async () => {
  const { initializeLocalMonaco } = await import("./monaco-local");
  await initializeLocalMonaco();
  return import("@monaco-editor/react");
});

/** Load the bundled editor on first use, after configuring its local loader. */
export default function LocalEditor(props: EditorProps) {
  return (
    <Suspense fallback={<div role="status">Loading editor…</div>}>
      <BundledEditor {...props} />
    </Suspense>
  );
}
