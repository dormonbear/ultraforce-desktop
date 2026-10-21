"""Check release version alignment. / 检查发布版本一致性。"""

import argparse
import json
from pathlib import Path
import sys
import tomllib


def check_versions(root: Path) -> str:
    def read_json(path: str):
        return json.loads((root / path).read_text(encoding="utf-8"))

    expected = read_json(".release-please-manifest.json")["."]
    if not isinstance(expected, str) or not expected:
        raise ValueError("Missing release version / 缺失发布版本")
    versions = {
        path: read_json(path)["version"]
        for path in (
            "desktop/package.json",
            "npm/package.json",
            "desktop/src-tauri/tauri.conf.json",
        )
    }
    manifest = tomllib.loads((root / "desktop/src-tauri/Cargo.toml").read_text(encoding="utf-8"))["package"]
    versions["desktop/src-tauri/Cargo.toml"] = manifest["version"]
    packages = tomllib.loads((root / "Cargo.lock").read_text(encoding="utf-8"))["package"]
    owned = [package for package in packages if package["name"] == manifest["name"] and "source" not in package]
    if len(owned) != 1:
        raise ValueError("Expected one local desktop lock entry / 桌面锁文件须恰有一条本地应用记录")
    versions["Cargo.lock"] = owned[0]["version"]
    for path, version in versions.items():
        if version != expected:
            raise ValueError(
                f"Version mismatch at {path}: {version}, expected {expected} / "
                f"{path} 版本不一致：{version}，应为 {expected}"
            )
    return expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        version = check_versions(args.root)
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Release version check failed / 发布版本检查失败: {error}", file=sys.stderr)
        return 1
    print(f"Release versions match: {version} / 发布版本一致：{version}")
    return 0


if __name__ == "__main__":
    # Redirected Windows streams may default to cp1252; emit bilingual UTF-8. / Windows 重定向流可能默认 cp1252；统一输出双语 UTF-8。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
