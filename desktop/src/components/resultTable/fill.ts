/**
 * Ratio to stretch measured column widths so they fill the container. Columns
 * are laid out at their natural sizes and multiplied by this ratio at render
 * time; when they already overflow (or inputs are degenerate) the ratio is 1,
 * so widths are never shrunk.
 */
export function computeFillRatio(
  containerW: number,
  gutterW: number,
  totalColW: number,
): number {
  if (containerW <= 0 || totalColW <= 0) return 1;
  return Math.max(1, (containerW - gutterW) / totalColW);
}
