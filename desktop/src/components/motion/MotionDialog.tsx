import { Dialog } from "@astryxdesign/core/Dialog";
import { cn } from "@/lib/utils";
import { useOverlayExit } from "../../hooks/useOverlayExit";

type DialogProps = React.ComponentProps<typeof Dialog>;

/**
 * Drop-in wrapper around the astryx `Dialog` that adds a symmetric exit.
 *
 * astryx closes via `dialog.close()` the moment `isOpen` flips false, so the
 * enter animation has no exit counterpart. This keeps the dialog mounted
 * through a CSS exit phase (`.uf-motion-dialog` overrides in styles.css) and
 * only lets astryx close — restoring focus to the trigger — once the exit
 * animation ends. Escape/backdrop still route through `onOpenChange`; the
 * parent flips its own state, which drives the exit here. Under reduced motion
 * the overlay closes instantly (see {@link useOverlayExit}).
 */
export function MotionDialog({
  isOpen,
  className,
  onAnimationEnd,
  ...props
}: DialogProps) {
  const { mounted, exiting, onAnimationEnd: onExitEnd } = useOverlayExit(isOpen, {
    exitName: "fjord-dialog-out",
    exitMs: 120,
  });

  return (
    <Dialog
      isOpen={mounted}
      className={cn("uf-motion-dialog", className)}
      data-motion-phase={exiting ? "exit" : undefined}
      onAnimationEnd={(event) => {
        onExitEnd(event);
        onAnimationEnd?.(event);
      }}
      {...props}
    />
  );
}
