import * as React from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { useOverlayExit } from "../hooks/useOverlayExit";
import { DIALOG_EXIT } from "./motion/presets";

interface ConfirmOptions {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/** Command-style in-app confirmation: `if (await confirm({...})) …`. Replaces
 * `window.confirm` (a silent no-op inside the Tauri webview) with a themed,
 * accessible Astryx AlertDialog. Must be used under {@link ConfirmProvider}. */
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
        // setTimeout hops out of any ambient React transition. Astryx Buttons
        // run clickAction inside startTransition(async …); if setOpts joined
        // that transition it would never commit (the transition awaits this
        // promise, which needs the dialog rendered to settle) — deadlock.
        setTimeout(() => setOpts(next), 0);
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

/** The dialog surface for the current request. Settling on action runs before
 * the close-driven onOpenChange; the second settle is a no-op (resolver ref is
 * already cleared). Cyclomatic count is inflated by per-field option
 * fallbacks, not real branching.
 *
 * AlertDialog wraps astryx Dialog but only forwards `ref`/`className` (not
 * data-* or onAnimationEnd), so the symmetric exit is wired imperatively: keep
 * it mounted through the exit phase and drive `data-motion-phase`/`animationend`
 * on the underlying <dialog> via its ref. The last non-null options are
 * retained so the exit animation shows the same content, not the defaults. */
// fallow-ignore-next-line complexity
function ConfirmDialog({
  opts,
  onSettle,
}: {
  opts: ConfirmOptions | null;
  onSettle: (result: boolean) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const shownRef = React.useRef<ConfirmOptions>({});
  if (opts) shownRef.current = opts;
  const shown = shownRef.current;

  const { mounted, exiting, onAnimationEnd } = useOverlayExit(
    opts !== null,
    DIALOG_EXIT,
  );

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (exiting) el.setAttribute("data-motion-phase", "exit");
    else el.removeAttribute("data-motion-phase");
  }, [exiting]);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = (event: AnimationEvent) => onAnimationEnd(event);
    el.addEventListener("animationend", handler);
    return () => el.removeEventListener("animationend", handler);
  }, [onAnimationEnd]);

  return (
    <AlertDialog
      ref={dialogRef}
      className="uf-motion-dialog"
      isOpen={mounted}
      onOpenChange={(open) => {
        if (!open) onSettle(false);
      }}
      title={shown.title ?? "Are you sure?"}
      description={shown.description ?? ""}
      cancelLabel={shown.cancelText ?? "Cancel"}
      actionLabel={shown.confirmText ?? "Confirm"}
      onAction={() => onSettle(true)}
    />
  );
}
