import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title?: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/** Command-style in-app confirmation: `if (await confirm({...})) …`. Replaces
 * `window.confirm` (a silent no-op inside the Tauri webview) with a themed,
 * accessible Radix AlertDialog. Must be used under {@link ConfirmProvider}. */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

/** Mounts a single AlertDialog and exposes the imperative `confirm()` to the
 * tree. One dialog at a time — confirmations are modal and serial. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  // Resolver for the in-flight promise; kept in a ref so it is never settled
  // from inside a state updater (which React StrictMode double-invokes).
  const resolveRef = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (next) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpts(next);
      }),
    [],
  );

  const settle = React.useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog opts={opts} onSettle={settle} />
    </ConfirmContext.Provider>
  );
}

/** The dialog surface for the current request; cyclomatic count is inflated by
 * per-field option fallbacks, not real branching. */
// fallow-ignore-next-line complexity
function ConfirmDialog({
  opts,
  onSettle,
}: {
  opts: ConfirmOptions | null;
  onSettle: (result: boolean) => void;
}) {
  return (
    <AlertDialog
      open={opts !== null}
      onOpenChange={(open) => {
        if (!open) onSettle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title ?? "Are you sure?"}</AlertDialogTitle>
          {opts?.description != null && (
            <AlertDialogDescription>{opts.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onSettle(false)}>
            {opts?.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => onSettle(true)}>
            {opts?.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
