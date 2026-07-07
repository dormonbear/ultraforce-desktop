import { Theme as AstryxTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import type { ReactNode } from "react";
import { useTheme } from "./theme";

export function AstryxSpikeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <AstryxTheme theme={neutralTheme} mode={theme}>
      {children}
    </AstryxTheme>
  );
}
