import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const states = [
  "Bound", "Closed", "CloseWait", "Closing", "DeleteTCB", "Established", "FinWait1",
  "FinWait2", "LastAck", "Listen", "SynReceived", "SynSent", "TimeWait",
];
const header = "GitHub Windows TCP state counts / GitHub Windows TCP 连接状态计数";
const script = fileURLToPath(new URL("../../scripts/report_windows_browser_resources.py", import.meta.url));

function safeSummary(output) {
  if (typeof output !== "string") return null;
  const lines = output.replaceAll("\r\n", "\n").trimEnd().split("\n");
  if (lines.length !== states.length + 1 || lines[0] !== header) return null;
  for (let index = 0; index < states.length; index += 1) {
    const match = new RegExp(`^${states[index]}: (0|[1-9]\\d*)$`).exec(lines[index + 1]);
    if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  }
  return lines.join("\n");
}

export default class WindowsResourceReporter {
  constructor(options = {}) {
    this.environment = options.environment ?? process.env;
    this.run = options.run ?? spawnSync;
    this.write = options.write ?? ((value) => process.stdout.write(value));
    this.captured = false;
  }

  onTestEnd(test, result) {
    const env = this.environment;
    if (this.captured || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Windows" || env.PERF_PROD !== "1") return;
    if ((result.status !== "failed" && result.status !== "timedOut") || result.status === test.expectedStatus) return;
    this.captured = true;

    let summary = null;
    try {
      const command = this.run("python", [script], { encoding: "utf8", timeout: 35000, maxBuffer: 4096, windowsHide: true });
      if (command.status === 0) summary = safeSummary(command.stdout);
    } catch {
      summary = null;
    }
    if (summary === null) {
      this.write("Windows CI socket summary unavailable / Windows CI socket 汇总不可用\n");
      return;
    }
    this.write(`First unexpected browser failure / 首次意外浏览器失败\n${summary}\n`);
  }
}
