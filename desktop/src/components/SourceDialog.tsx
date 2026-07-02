import { useCallback, useEffect, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { configureMonacoApex } from "../editor/monaco-apex";
import { EDITOR_OPTS } from "../editor/monaco-opts";
import { useTheme, monacoTheme } from "../theme";
import type { SourceRef } from "../panels/sourceRef";
import { revealLine, useApexSource } from "./useApexSource";

/** Read-only viewer for an Apex class/trigger's source, fetched from the org on
 * open. Syntax-highlighted via Monaco (Apex language) and scrolled to + line-
 * highlighting the target line — "jump to source". */
export function SourceDialog({
  target,
  onClose,
}: {
  target: SourceRef | null;
  onClose: () => void;
}) {
  const { theme, scheme } = useTheme();
  const { src, error } = useApexSource(target?.className ?? null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decoRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  // Scroll to the target line and mark it with a persistent whole-line highlight
  // (Monaco's cursor-line highlight alone is too faint to spot a jumped-to line).
  const highlight = useCallback(
    (ed: editor.IStandaloneCodeEditor | null, line: number | null) => {
      revealLine(ed, line);
      if (!ed) return;
      if (line == null) {
        decoRef.current?.clear();
        return;
      }
      const deco = [
        {
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: { isWholeLine: true, className: "apex-target-line" },
        },
      ];
      if (decoRef.current) decoRef.current.set(deco);
      else decoRef.current = ed.createDecorationsCollection(deco);
    },
    [],
  );

  // Re-highlight once the source loads / the target changes.
  useEffect(() => {
    highlight(editorRef.current, target?.line ?? null);
  }, [src, target, highlight]);

  const onMount: OnMount = (instance) => {
    editorRef.current = instance;
    decoRef.current = null;
    highlight(instance, target?.line ?? null);
  };

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[85vw] max-w-[85vw] flex-col gap-3 sm:max-w-[85vw]">
        <DialogHeader>
          <DialogTitle>
            {target?.className}
            {src ? ` · ${src.kind}` : ""}
            {target?.line != null ? ` · line ${target.line}` : ""}
          </DialogTitle>
        </DialogHeader>
        {!src && !error && (
          <div className="flex items-center gap-2 py-6 text-sm text-text-dim">
            <Loader2 className="spin" size={16} /> Fetching source…
          </div>
        )}
        {error && <div className="py-4 text-[12px] text-destructive">{error}</div>}
        {src && (
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <Editor
              height="100%"
              language="apex"
              theme={monacoTheme(theme, scheme)}
              value={src.body}
              beforeMount={(monaco: Monaco) => configureMonacoApex(monaco)}
              onMount={onMount}
              options={{
                ...EDITOR_OPTS,
                readOnly: true,
                lineNumbers: "on",
                // Read-only source peek: no right-click menu (drops Monaco's
                // "Command Palette" entry). Cmd/Ctrl+C still copies a selection.
                contextmenu: false,
              }}
              loading={<Loader2 size={18} className="spin text-muted-foreground" />}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
