"""Keep the installed browser discoverable while isolating app data. / 隔离应用数据时保持已安装浏览器可被发现。"""
import os
from pathlib import Path
import re
import subprocess


def runtime_folder(environment, version):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Invalid WebView2 version / WebView2 版本无效")
    for key in ["LOCALAPPDATA", "ProgramFiles(x86)", "ProgramFiles"]:
        if not environment.get(key):
            continue
        folder = Path(environment[key]) / "Microsoft" / "EdgeWebView" / "Application" / version
        if (folder / "msedgewebview2.exe").is_file():
            return folder
    raise FileNotFoundError("Matching installed WebView2 runtime missing / 缺少匹配的已安装 WebView2 运行时: " + version)


def matching_runtime():
    output = subprocess.check_output(["msedgedriver", "--version"], encoding="utf-8")
    match = re.search(r"\b[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\b", output)
    if not match:
        raise ValueError("Cannot parse native driver version / 无法解析原生驱动版本")
    return runtime_folder(os.environ, match.group())
