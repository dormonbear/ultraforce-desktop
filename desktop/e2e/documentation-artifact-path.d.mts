import type { TestInfo } from "@playwright/test";

export function documentationArtifactPath(
  testInfo: Pick<TestInfo, "config" | "outputPath">,
  documentationPath: string,
  artifactName: string,
): string;
