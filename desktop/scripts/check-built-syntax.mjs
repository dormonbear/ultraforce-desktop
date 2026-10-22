import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export function staticBlocks(source, fileName) {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) {
    throw new Error(`Cannot parse built JavaScript / 无法解析构建的 JavaScript: ${fileName}`);
  }
  const locations = [];
  function visit(node) {
    if (ts.isClassStaticBlockDeclaration(node)) {
      const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      locations.push(`${position.line + 1}:${position.character + 1}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return locations;
}

export function checkBuiltSyntax(directory) {
  let files = 0;
  const failures = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        files++;
        const locations = staticBlocks(readFileSync(file, "utf8"), file);
        if (locations.length) {
          failures.push(`${path.relative(directory, file)}: ${locations.length} (${locations[0]})`);
        }
      }
    }
  }
  walk(directory);
  if (!files) throw new Error("No built JavaScript found / 未找到构建的 JavaScript");
  if (failures.length) {
    throw new Error(`Class static blocks require newer WebKit / 类静态块需要更高版本的 WebKit:\n${failures.join("\n")}`);
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const directory = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
    const files = checkBuiltSyntax(directory);
    console.log(`Built syntax check passed: ${files} JavaScript files / 构建语法检查通过：${files} 个 JavaScript 文件`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
