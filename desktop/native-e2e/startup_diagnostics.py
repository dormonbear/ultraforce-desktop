"""Owned synthetic startup diagnostics, captured only on hosted CI. / 仅在托管 CI 采集专属合成启动诊断。"""
import os
from pathlib import Path
import subprocess


def capture_desktop(path):
    # Never capture a developer's desktop or a self-hosted runner. / 绝不采集开发者桌面或自托管运行器。
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        return False
    result = subprocess.run([
        "powershell", "-NoProfile", "-File", str(Path(__file__).with_name("capture-desktop.ps1")),
    ], env={**os.environ, "UF_NATIVE_SCREENSHOT": str(path)}, capture_output=True, check=False)
    return result.returncode == 0
