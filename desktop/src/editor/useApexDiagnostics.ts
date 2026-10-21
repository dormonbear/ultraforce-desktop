import { useEffect, type RefObject } from "react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { apexDiagnostics, apexSoqlDiagnostics } from "../ipc/apex";
import { diagnosticsToMarkers } from "./monaco-markers";

interface Inputs {
  src: string;
  org: string | null;
  mounted: boolean;
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  monacoRef: RefObject<Monaco | null>;
}

export function useApexDiagnostics({ src, org, mounted, editorRef, monacoRef }: Inputs) {
  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!mounted || !instance || !monaco) return;
    const model = instance.getModel();
    if (!model || model.isDisposed()) return;
    let active = true;
    const current = () =>
      active &&
      editorRef.current === instance &&
      monacoRef.current === monaco &&
      !model.isDisposed() &&
      instance.getModel() === model;
    // Old markers belong to the previous source/org. / 旧标记属于之前的源码／组织。
    monaco.editor.setModelMarkers(model, "apex-soql", []);
    monaco.editor.setModelMarkers(model, "apex-ast", []);
    const handle = setTimeout(async () => {
      if (!current()) return;
      try {
        const soql = await apexSoqlDiagnostics(src, org);
        if (!current()) return;
        monaco.editor.setModelMarkers(model, "apex-soql", diagnosticsToMarkers(monaco, model, soql));
      } catch {
        // Diagnostic owners fail independently. / 各诊断来源独立处理失败。
      }
      if (!current()) return;
      try {
        const ast = await apexDiagnostics(src, org);
        if (!current()) return;
        monaco.editor.setModelMarkers(model, "apex-ast", diagnosticsToMarkers(monaco, model, ast));
      } catch {
        // Diagnostic owners fail independently. / 各诊断来源独立处理失败。
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [src, org, mounted, editorRef, monacoRef]);
}
