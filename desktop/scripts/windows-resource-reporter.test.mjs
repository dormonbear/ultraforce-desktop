import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import WindowsResourceReporter from "../e2e/windows-resource-reporter.mjs";

const states = [
  "Bound", "Closed", "CloseWait", "Closing", "DeleteTCB", "Established", "FinWait1",
  "FinWait2", "LastAck", "Listen", "SynReceived", "SynSent", "TimeWait",
];
const header = "GitHub Windows TCP state counts / GitHub Windows TCP 连接状态计数";
const validSummary = [header, ...states.map((state, index) => `${state}: ${index}`)].join("\n") + "\n";
const windowsCI = { GITHUB_ACTIONS: "true", RUNNER_OS: "Windows", PERF_PROD: "1" };

test("captures only the first unexpected Windows CI failure / 仅采集 Windows CI 首次意外失败", () => {
  const calls = [];
  const output = [];
  const reporter = new WindowsResourceReporter({
    environment: windowsCI,
    run: (...args) => { calls.push(args); return { status: 0, stdout: validSummary, stderr: "private.example.invalid" }; },
    write: (value) => output.push(value),
  });
  reporter.onTestEnd({ expectedStatus: "passed" }, { status: "passed" });
  reporter.onTestEnd({ expectedStatus: "failed" }, { status: "failed" });
  assert.equal(calls.length, 0);
  reporter.onTestEnd({ expectedStatus: "passed" }, { status: "failed" });
  reporter.onTestEnd({ expectedStatus: "passed" }, { status: "timedOut" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "python");
  assert.match(calls[0][1][0], /report_windows_browser_resources\.py$/);
  assert.equal(calls[0][2].timeout, 35000);
  assert.match(output.join(""), /First unexpected browser failure/);
  for (const line of validSummary.trimEnd().split("\n")) assert.ok(output.join("").includes(line));
  assert.doesNotMatch(output.join(""), /private\.example\.invalid/);
});

test("does not collect outside production Windows CI / 正式 Windows CI 以外不采集", () => {
  for (const environment of [{}, { ...windowsCI, RUNNER_OS: "macOS" },
    { ...windowsCI, GITHUB_ACTIONS: "false" }, { ...windowsCI, PERF_PROD: "0" }]) {
    const reporter = new WindowsResourceReporter({ environment, run: () => assert.fail("Unexpected collection / 不应采集"), write: () => assert.fail("Unexpected output / 不应输出") });
    reporter.onTestEnd({ expectedStatus: "passed" }, { status: "failed" });
  }
});

test("suppresses malformed output and raw subprocess errors / 隐藏格式错误的输出和原始子进程错误", () => {
  for (const run of [
    () => ({ status: 0, stdout: `${validSummary}private.example.invalid\n` }),
    () => ({ status: 0, stdout: validSummary.replace("Bound: 0", "Bound: -1") }),
    () => ({ status: 0, stdout: validSummary.replace("Closed: 1", "Closed: private.example.invalid") }),
    () => ({ status: 0, stdout: validSummary.replace("TimeWait: 12", "TimeWait: 9999999999999999999999999") }),
    () => ({ status: 1, stdout: "private.example.invalid", stderr: "private.example.invalid" }),
    () => { throw new Error("private.example.invalid"); },
  ]) {
    const output = [];
    const reporter = new WindowsResourceReporter({ environment: windowsCI, run, write: (value) => output.push(value) });
    reporter.onTestEnd({ expectedStatus: "passed" }, { status: "failed" });
    assert.match(output.join(""), /unavailable/);
    assert.doesNotMatch(output.join(""), /private\.example\.invalid/);
  }
});

test("captures an unexpected timeout / 采集意外超时", () => {
  const output = [];
  const reporter = new WindowsResourceReporter({
    environment: windowsCI,
    run: () => ({ status: 0, stdout: validSummary }),
    write: (value) => output.push(value),
  });
  reporter.onTestEnd({ expectedStatus: "passed" }, { status: "timedOut" });
  assert.match(output.join(""), /First unexpected browser failure/);
});

function browserStep(workflow) {
  return workflow.replaceAll("\r\n", "\n").split("      - name: Production browser regressions / 正式构建浏览器回归\n", 2)[1].split("\n      - name:", 1)[0];
}

test("CI explicitly registers the reporter with the production browser step / CI 在正式浏览器步骤明确注册报告器", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const browser = browserStep(workflow);
  assert.match(browser, /PERF_PROD: '1'/);
  assert.match(browser, /--reporter=line,\.\/e2e\/windows-resource-reporter\.mjs/);
});

test("workflow inspection accepts LF and CRLF / 工作流检查支持 LF 和 CRLF 换行", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const source of [workflow, workflow.replaceAll("\n", "\r\n")]) {
    assert.match(browserStep(source), /--reporter=line,\.\/e2e\/windows-resource-reporter\.mjs/);
  }
});

test("Playwright reports promptly and still runs later tests after failure / Playwright 及时汇总且失败后继续运行后续测试", () => {
  const root = mkdtempSync(join(tmpdir(), "uf-early-summary-"));
  try {
    const require = createRequire(import.meta.url);
    const playwright = require.resolve("@playwright/test");
    const cli = require.resolve("@playwright/test/cli");
    const reporter = fileURLToPath(new URL("../e2e/windows-resource-reporter.mjs", import.meta.url));
    const spec = `const { test, expect } = require(${JSON.stringify(playwright)});\n` +
      `test('synthetic failure / 合成失败', () => expect(1).toBe(2));\n` +
      `test('synthetic continuation / 合成后续测试', () => console.log('SECOND_CASE_RAN'));\n`;
    writeFileSync(join(root, "sample.spec.js"), spec);
    const config = `module.exports = { testDir: ${JSON.stringify(root)}, workers: 1, retries: 0, ` +
      `reporter: [['line'], [${JSON.stringify(reporter)}, { environment: ${JSON.stringify(windowsCI)}, ` +
      `run: () => ({ status: 0, stdout: ${JSON.stringify(validSummary)}, stderr: 'private.example.invalid' }) }]] };\n`;
    const configPath = join(root, "playwright.config.cjs");
    writeFileSync(configPath, config);
    const result = spawnSync(process.execPath, [cli, "test", "--config", configPath], { encoding: "utf8", timeout: 30000 });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, output);
    assert.ok(output.indexOf("First unexpected browser failure") >= 0, output);
    assert.ok(output.indexOf("First unexpected browser failure") < output.indexOf("SECOND_CASE_RAN"), output);
    assert.match(output, /1 failed/);
    assert.match(output, /1 passed/);
    assert.doesNotMatch(output, /private\.example\.invalid/);

    const cliReporter = spawnSync(process.execPath, [cli, "test", "--config", configPath,
      `--reporter=line,${reporter}`], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, GITHUB_ACTIONS: "false" },
    });
    const cliOutput = cliReporter.stdout + cliReporter.stderr;
    assert.equal(cliReporter.status, 1, cliOutput);
    assert.match(cliOutput, /1 failed/);
    assert.match(cliOutput, /1 passed/);
    assert.doesNotMatch(cliOutput, /First unexpected browser failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
