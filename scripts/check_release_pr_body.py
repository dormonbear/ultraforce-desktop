"""Validate the single-package release PR envelope. / 校验单包发布 PR 的正文结构。"""
import argparse
import json
from pathlib import Path
import re
import sys


def check_body(body: str, version: str) -> None:
    lines = body.strip().splitlines()
    delimiters = [i for i, line in enumerate(lines) if line == "---"]
    if len(delimiters) < 2:
        raise ValueError("Keep both Release Please separators / 保留 Release Please 的两个分隔符")
    first, last = delimiters[0], delimiters[-1]
    if not "\n".join(lines[:first]).strip() or not "\n".join(lines[last + 1:]).strip():
        raise ValueError("Keep the generated header and footer / 保留生成的页首及页尾")
    notes = "\n".join(lines[first + 1:last]).strip()
    heading = re.match(r"^#{2,} \[?([^\]\s(]+)\]?(?:\(|\s|$)", notes)
    if not heading:
        raise ValueError("Release notes must begin with the version heading / 发布说明须以版本标题开头")
    if heading[1] != version:
        raise ValueError("Release body version must match the manifest / 发布正文版本须与清单一致")
    if not "\n".join(notes.splitlines()[1:]).strip():
        raise ValueError("Release notes are empty / 发布说明为空")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--body-file", type=Path, required=True)
    parser.add_argument("--version-file", type=Path,
                        default=Path(__file__).resolve().parents[1] / ".release-please-manifest.json")
    args = parser.parse_args()
    try:
        version = json.loads(args.version_file.read_text(encoding="utf-8"))["."]
        check_body(args.body_file.read_text(encoding="utf-8"), version)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Release PR body check failed / 发布 PR 正文检查失败: {error}", file=sys.stderr)
        return 1
    print(f"Release PR body matches {version} / 发布 PR 正文与 {version} 一致")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
