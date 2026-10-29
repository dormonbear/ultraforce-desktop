import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

/** Guard the shipped consumer, including Monaco's vendored bypass. / 检查实际打包调用方，包括 Monaco 内置实现的绕过路径。 */
export function monacoSanitizer(): Plugin {
  return {
    name: "monaco-sanitizer",
    apply: "build",
    generateBundle() {
      const modules = [...this.getModuleIds()].map((id) => id.replace(/\\/g, "/"));
      const maintained = modules.some((id) => id.endsWith("/node_modules/dompurify/dist/purify.es.mjs"));
      const vendored = modules.some((id) => id.endsWith("/monaco-editor/esm/vs/base/browser/dompurify/dompurify.js"));
      if (!maintained || vendored) {
        this.error("Production build must use maintained DOMPurify, without Monaco's vendored copy / 生产构建必须使用维护中的 DOMPurify，不得包含 Monaco 内置副本");
      }
      const require = createRequire(import.meta.url);
      const monacoRequire = createRequire(require.resolve("monaco-editor/package.json"));
      const entry = monacoRequire.resolve("dompurify");
      let metadata: unknown;
      try {
        metadata = JSON.parse(readFileSync(resolve(dirname(entry), "../package.json"), "utf8"));
      } catch {
        this.error("Cannot read DOMPurify package metadata / 无法读取 DOMPurify 软件包元信息");
      }
      if (!metadata || typeof metadata !== "object" || !("version" in metadata) || typeof metadata.version !== "string") {
        this.error("Invalid DOMPurify package version / DOMPurify 软件包版本无效");
      }
      const parts = metadata.version.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
      if (!parts || parts[0] < 3 || (parts[0] === 3 && (parts[1] < 4 || (parts[1] === 4 && parts[2] < 17)))) {
        this.error("Production DOMPurify must be at least 3.4.17 / 生产构建的 DOMPurify 版本不得低于 3.4.17");
      }
    },
  };
}
