import { useEffect, useRef } from "react";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
import logoLoading from "../assets/logo-loading.json";
import { useReducedMotion } from "../hooks/useReducedMotion";

interface Props {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

/** Brand loading animation: the two logo arrows fly in from the left, pause in
 * the center, then fly out to the right, looping. Under reduced motion it holds
 * a single centered frame instead of running the Lottie loop. */
export function LogoLoader({ size = 96, className }: Props) {
  const reduced = useReducedMotion();
  const ref = useRef<LottieRefCurrentProps>(null);

  useEffect(() => {
    // Frame 60 is the center pause of the 120-frame loop (fr=60, op=120).
    if (reduced) ref.current?.goToAndStop(60, true);
  }, [reduced]);

  return (
    <Lottie
      lottieRef={ref}
      animationData={logoLoading}
      loop={!reduced}
      autoplay={!reduced}
      data-motion="decorative"
      className={className}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
