"""Gate workspace and desktop Rust coverage. / 检查工作区及桌面 Rust 覆盖率门槛。"""
import argparse
import json
from pathlib import Path
import sys

FLOORS = {"lines": 84.0, "functions": 82.0, "desktop_lines": 40.0}


def counts(summary, allow_empty=False):
    if not isinstance(summary, dict):
        raise ValueError("Missing coverage counts / 缺失覆盖率计数")
    total, covered = summary.get("count"), summary.get("covered")
    if (type(total) is not int or type(covered) is not int
            or total < 0 or not 0 <= covered <= total or (not allow_empty and total == 0)):
        raise ValueError("Invalid coverage counts / 覆盖率计数无效")
    return total, covered


def check_report(report, workspace):
    if not isinstance(report, dict) or report.get("type") != "llvm.coverage.json.export":
        raise ValueError("Expected an LLVM coverage export / 需要 LLVM 覆盖率导出")
    data = report.get("data")
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError("Expected one workspace report / 需要一份工作区报告")
    data = data[0]
    totals = data.get("totals", {})
    metrics = {}
    for metric in ("lines", "functions"):
        total, covered = counts(totals.get(metric) if isinstance(totals, dict) else None)
        metrics[metric] = 100 * covered / total
    files = data.get("files")
    if not isinstance(files, list):
        raise ValueError("Missing per-file coverage / 缺失逐文件覆盖率")
    prefix = Path(workspace).resolve().as_posix().rstrip("/") + "/"
    desktop_total = desktop_covered = 0
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get("filename"), str):
            raise ValueError("Invalid coverage file entry / 覆盖率文件条目无效")
        name = entry["filename"].replace("\\", "/")
        if name.startswith(prefix):
            name = name[len(prefix):]
        if name.startswith("desktop/src-tauri/"):
            summary = entry.get("summary")
            total, covered = counts(summary.get("lines") if isinstance(summary, dict) else None, allow_empty=True)
            desktop_total += total
            desktop_covered += covered
    if desktop_total == 0:
        raise ValueError("Desktop Rust coverage is missing / 缺失桌面 Rust 覆盖率")
    metrics["desktop_lines"] = 100 * desktop_covered / desktop_total
    for metric, minimum in FLOORS.items():
        if metrics[metric] < minimum:
            raise ValueError(
                f"{metric} coverage {metrics[metric]:.2f}% is below {minimum:g}% / "
                f"{metric} 覆盖率低于 {minimum:g}% 门槛"
            )
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary-file", type=Path, required=True)
    parser.add_argument("--workspace-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        metrics = check_report(json.loads(args.summary_file.read_text(encoding="utf-8")), args.workspace_root)
    except (OSError, ValueError, TypeError) as error:
        print(f"Rust coverage check failed / Rust 覆盖率检查失败: {error}", file=sys.stderr)
        return 1
    values = ", ".join(f"{name}={value:.2f}%" for name, value in metrics.items())
    print(f"Rust coverage passed / Rust 覆盖率通过: {values}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
