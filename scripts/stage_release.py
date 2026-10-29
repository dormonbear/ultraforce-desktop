"""Publish only a complete staged release. / 仅公开产物齐全的暂存发布。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from build_updater_manifest import REPOSITORY, build_manifest, required_assets, utc_date


def run_gh(*args: str) -> str:
    return subprocess.run(
        ["gh", *args], check=True, capture_output=True, encoding="utf-8",
    ).stdout


def asset_map(metadata: dict) -> dict:
    assets = metadata["assets"]
    names = [asset["name"] for asset in assets]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate release assets / 发布产物名称重复")
    return {asset["name"]: asset for asset in assets}


def required_snapshot(metadata: dict, tag: str) -> tuple[dict, str]:
    assets = asset_map(metadata)
    names = required_assets(tag[1:])
    fields = ("id", "name", "size", "state", "digest", "browser_download_url", "updated_at")
    snapshot = {name: {key: assets[name].get(key) for key in fields} for name in names}
    updated_at = max(utc_date(assets[name]["updated_at"]) for name in names)
    return snapshot, updated_at


def validate_latest(metadata: dict, tag: str, raw: bytes, expected: dict) -> None:
    asset = asset_map(metadata)["latest.json"]
    url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/latest.json"
    if (asset.get("state") != "uploaded" or asset.get("size") != len(raw)
            or asset.get("digest") != "sha256:" + hashlib.sha256(raw).hexdigest()
            or asset.get("browser_download_url") != url):
        raise ValueError("Invalid staged manifest asset / 暂存清单产物无效")
    actual = json.loads(raw)
    if not isinstance(actual, dict):
        raise ValueError("Invalid updater manifest / 更新清单无效")
    utc_date(actual.get("pub_date"))
    if actual != expected:
        raise ValueError("Existing manifest differs / 已有清单不一致")


def stage_release(tag: str, *, gh=run_gh) -> None:
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Invalid release tag / 无效的发布标签")
    release_id = gh("release", "view", tag, "--repo", REPOSITORY, "--json", "databaseId", "--jq", ".databaseId").strip()
    if not re.fullmatch(r"[1-9]\d*", release_id):
        raise ValueError("Invalid release identity / 无效的发布标识")

    def metadata() -> dict:
        value = json.loads(gh("api", f"repos/{REPOSITORY}/releases/{release_id}"))
        if value.get("id") != int(release_id) or value.get("tag_name") != tag:
            raise ValueError("Release identity changed / 发布标识已变化")
        return value

    with tempfile.TemporaryDirectory(prefix="uf-release-stage-") as directory:
        root = Path(directory)
        first = metadata()
        gh("release", "download", tag, "--repo", REPOSITORY, "--pattern", "*.sig", "--dir", str(root))
        snapshot, staged_at = required_snapshot(first, tag)
        if first.get("draft") is True:
            expected = build_manifest(first, root, staged_at=staged_at)
        elif first.get("draft") is False:
            expected = build_manifest(first, root, require_complete=True)
            expected["pub_date"] = staged_at
        else:
            raise ValueError("Invalid release state / 无效的发布状态")

        manifest_path = root / "latest.json"
        if "latest.json" in asset_map(first):
            gh("release", "download", tag, "--repo", REPOSITORY, "--pattern", "latest.json", "--dir", str(root))
            validate_latest(first, tag, manifest_path.read_bytes(), expected)
        elif first["draft"]:
            current = metadata()
            if current.get("draft") is not True or required_snapshot(current, tag) != (snapshot, staged_at):
                raise ValueError("Draft changed before upload / 上传前草稿已变化")
            if build_manifest(current, root, staged_at=staged_at) != expected:
                raise ValueError("Draft assets changed / 草稿产物已变化")
            manifest_path.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
            # Never replace a public asset or delete an existing one on retry. / 重试时绝不替换公开产物或删除已有产物。
            gh("release", "upload", tag, str(manifest_path), "--repo", REPOSITORY)
        else:
            raise ValueError("Published manifest missing / 已公开清单缺失")

        current = metadata()
        if required_snapshot(current, tag) != (snapshot, staged_at):
            raise ValueError("Release assets changed / 发布产物已变化")
        if current.get("draft") is True:
            verified = build_manifest(current, root, staged_at=staged_at)
            validate_latest(current, tag, manifest_path.read_bytes(), verified)
            gh("release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--verify-tag")
            current = metadata()
        if current.get("draft") is not False:
            raise ValueError("Release was not published / 发布尚未公开")
        verified = build_manifest(current, root, require_complete=True)
        # The staged manifest records the last required upload time. / 暂存清单记录最后一个必需产物的上传时间。
        verified["pub_date"] = staged_at
        validate_latest(current, tag, manifest_path.read_bytes(), verified)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        stage_release(args.tag)
    except (KeyError, ValueError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release staging failed / 发布暂存失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
