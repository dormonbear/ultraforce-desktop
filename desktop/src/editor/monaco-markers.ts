import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { SoqlDiagnosticDto } from "../types";

/** Convert backend offset-based diagnostics into Monaco line/column markers. */
export function diagnosticsToMarkers(
  monaco: Monaco,
  model: editor.ITextModel,
  diags: SoqlDiagnosticDto[],
): editor.IMarkerData[] {
  return diags.map((d) => {
    const s = model.getPositionAt(d.start);
    const e = model.getPositionAt(d.end);
    return {
      message: d.message,
      severity:
        d.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Error,
      startLineNumber: s.lineNumber,
      startColumn: s.column,
      endLineNumber: e.lineNumber,
      endColumn: e.column,
    };
  });
}
