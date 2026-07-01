import Lottie from "lottie-react";
import logoLoading from "../assets/logo-loading.json";

interface Props {
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

/** Brand loading animation: the two logo arrows fly in from the left, pause in
 * the center, then fly out to the right, looping. */
export function LogoLoader({ size = 96, className }: Props) {
  return (
    <Lottie
      animationData={logoLoading}
      loop
      autoplay
      className={className}
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
