// All supported editors use our Apex/SOQL providers or plaintext. Bundle the
// editor and its worker so opening private code never contacts a public CDN.
// Registration helpers attach disposables to this object. An ESM namespace is
// non-extensible, so expose a mutable API facade like the standalone CDN build.
let initializing: Promise<void> | undefined;

export function initializeLocalMonaco(): Promise<void> {
  return initializing ??= (async () => {
    const [monaco, , { loader }, { default: EditorWorker }] = await Promise.all([
      import("monaco-editor/esm/vs/editor/editor.api"),
      import("monaco-editor/esm/vs/editor/edcore.main"),
      import("@monaco-editor/react"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
    ]);
    const localMonaco = { ...monaco };
    self.MonacoEnvironment = {
      globalAPI: true,
      getWorker: () => new EditorWorker(),
    };
    // Preserve the standalone API used by integrations and the UI harness.
    Object.assign(self, { monaco: localMonaco });
    loader.config({ monaco: localMonaco });
  })();
}
