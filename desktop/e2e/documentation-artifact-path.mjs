/** Route routine artifacts to test output; explicit snapshot updates may write docs. / 常规产物写入测试输出；显式更新快照时可写入文档。 */
export function documentationArtifactPath(testInfo, documentationPath, artifactName) {
  const mode = testInfo.config.updateSnapshots;
  return mode === "all" || mode === "changed"
    ? documentationPath
    : testInfo.outputPath(artifactName);
}
