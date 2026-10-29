"""Verify the draft and its tag before uploading builds. / 上传构建产物前验证草稿和标签。"""

import argparse
import json
import re
import subprocess
import sys

from build_updater_manifest import REPOSITORY


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, encoding="utf-8").stdout


def verify_release_build(tag: str, *, execute=run) -> None:
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Invalid release tag / 无效的发布标签")
    release = json.loads(execute(
        "gh", "release", "view", tag, "--repo", REPOSITORY,
        "--json", "tagName,isDraft,isPrerelease",
    ))
    if (release.get("tagName") != tag or release.get("isDraft") is not True
            or release.get("isPrerelease") is not False):
        raise ValueError("Expected matching stable draft / 需要匹配的稳定版草稿")
    execute("git", "fetch", "--no-tags", "origin", f"refs/tags/{tag}")
    checkout = execute("git", "rev-parse", "--verify", "HEAD^{commit}").strip()
    tagged = execute("git", "rev-parse", "--verify", "FETCH_HEAD^{commit}").strip()
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", checkout) or checkout != tagged:
        raise ValueError("Release tag does not match checkout / 发布标签与检出提交不一致")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        verify_release_build(args.tag)
    except (ValueError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release build rejected / 发布构建被拒绝: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
