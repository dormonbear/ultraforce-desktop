import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { documentationArtifactPath } from "../e2e/documentation-artifact-path.mjs";

for (const mode of ["missing", "none"]) {
  test(`routine ${mode} output preserves documentation / 常规 ${mode} 输出保留文档`, () => {
    const root = mkdtempSync(join(tmpdir(), "uf-artifacts-"));
    try {
      const docs = join(root, "docs");
      const output = join(root, "test-results");
      mkdirSync(docs);
      mkdirSync(output);
      const source = join(docs, "baseline.png");
      writeFileSync(source, "original");
      const info = { config: { updateSnapshots: mode }, outputPath: (name) => join(output, name) };
      writeFileSync(documentationArtifactPath(info, source, "baseline.png"), "generated");
      assert.equal(readFileSync(source, "utf8"), "original");
      assert.equal(readFileSync(join(output, "baseline.png"), "utf8"), "generated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const mode of ["all", "changed"]) {
  test(`explicit ${mode} update writes documentation / 显式 ${mode} 更新写入文档`, () => {
    const root = mkdtempSync(join(tmpdir(), "uf-artifacts-"));
    try {
      const docs = join(root, "docs");
      const output = join(root, "test-results");
      mkdirSync(docs);
      mkdirSync(output);
      const source = join(docs, "baseline.md");
      writeFileSync(source, "original");
      const info = { config: { updateSnapshots: mode }, outputPath: (name) => join(output, name) };
      writeFileSync(documentationArtifactPath(info, source, "baseline.md"), "generated");
      assert.equal(readFileSync(source, "utf8"), "generated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
