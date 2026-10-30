"""Summarize runner TCP states after browser failure. / 浏览器失败后汇总运行器 TCP 状态。"""

import json
import os
import subprocess
import sys


STATES = (
    "Bound", "Closed", "CloseWait", "Closing", "DeleteTCB", "Established",
    "FinWait1", "FinWait2", "LastAck", "Listen", "SynReceived", "SynSent", "TimeWait",
)

# PowerShell emits counts only, never connection records, addresses, ports or PIDs.
# PowerShell 仅输出计数，绝不输出连接记录、地址、端口或进程 ID。
POWERSHELL = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$states = @('Bound', 'Closed', 'CloseWait', 'Closing', 'DeleteTCB', 'Established',
            'FinWait1', 'FinWait2', 'LastAck', 'Listen', 'SynReceived', 'SynSent', 'TimeWait')
$connectionStates = @(Get-NetTCPConnection | ForEach-Object { $_.State.ToString() })
$counts = [ordered]@{}
foreach ($state in $states) {
    $counts[$state] = @($connectionStates | Where-Object { $_ -eq $state }).Count
}
$counts | ConvertTo-Json -Compress
""".strip()


def validate_counts(value):
    if (not isinstance(value, dict) or set(value) != set(STATES)
            or any(type(value[state]) is not int or value[state] < 0 for state in STATES)):
        raise ValueError("Invalid TCP state summary / TCP 状态汇总无效")
    return value


def collect_counts(*, runner=subprocess.run):
    result = runner(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, check=False,
    )
    if result.returncode != 0:
        raise ValueError("TCP state summary unavailable / TCP 状态汇总不可用")
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ValueError("Invalid TCP state summary / TCP 状态汇总无效") from error
    return validate_counts(value)


def main(*, environment=None, collector=None):
    environment = os.environ if environment is None else environment
    if environment.get("GITHUB_ACTIONS") != "true" or environment.get("RUNNER_OS") != "Windows":
        print("Windows CI socket summary skipped / 已跳过 Windows CI socket 汇总")
        return 0
    try:
        value = validate_counts((collector or collect_counts)())
    except (ValueError, TypeError, OSError, subprocess.SubprocessError):
        print("Windows CI socket summary unavailable / Windows CI socket 汇总不可用", file=sys.stderr)
        return 0
    print("GitHub Windows TCP state counts / GitHub Windows TCP 连接状态计数")
    for state in STATES:
        print(f"{state}: {value[state]}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
