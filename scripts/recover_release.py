"""Resume a verified release through the existing workflow. / 通过现有工作流恢复已验证的发布。"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from build_updater_manifest import REPOSITORY
from check_release_versions import check_versions
from stage_release import run_gh, stage_release


VERSION_FILES = (
    ".release-please-manifest.json", "desktop/package.json", "npm/package.json",
    "desktop/src-tauri/tauri.conf.json", "desktop/src-tauri/Cargo.toml", "Cargo.lock",
)


def run_git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, encoding="utf-8").stdout


def fetch_tag(tag: str, *, git=run_git) -> str:
    git("fetch", "--no-tags", "origin", f"refs/tags/{tag}")
    return git("rev-parse", "--verify", "FETCH_HEAD^{commit}").strip()


def npm_has_version(version: str, *, runner=subprocess.run) -> bool:
    result = runner(
        ["npm", "view", f"@dormon/ultraforce-mcp@{version}", "version", "--json",
         "--prefer-online", "--registry", "https://registry.npmjs.org"],
        capture_output=True, encoding="utf-8", check=False,
    )
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ValueError("Could not verify npm version / 无法验证 npm 版本") from error
    if result.returncode == 0 and value == version:
        return True
    if (result.returncode != 0 and isinstance(value, dict)
            and isinstance(value.get("error"), dict) and value["error"].get("code") == "E404"):
        return False
    raise ValueError("Could not verify npm version / 无法验证 npm 版本")


def recover_release(version: str, *, gh=run_gh, git=run_git, npm=npm_has_version, stage=stage_release) -> dict | None:
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Invalid release version / 无效的发布版本")
    tag = "v" + version
    pages = json.loads(gh("api", f"repos/{REPOSITORY}/releases?per_page=100", "--paginate", "--slurp"))
    if not isinstance(pages, list) or any(not isinstance(page, list) for page in pages):
        raise ValueError("Invalid release listing / 发布列表无效")
    releases = [release for page in pages for release in page]
    if any(not isinstance(release, dict) for release in releases):
        raise ValueError("Invalid release listing / 发布列表无效")
    matches = [release for release in releases if release.get("tag_name") == tag]
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError("Ambiguous release identity / 发布标识不唯一")
    release = matches[0]
    if (type(release.get("id")) is not int or release["id"] <= 0
            or type(release.get("draft")) is not bool or release.get("prerelease") is not False):
        raise ValueError("Invalid stable release / 稳定发布无效")
    registry_present = npm(version)
    if not release["draft"] and registry_present:
        return None

    sha = fetch_tag(tag, git=git)
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", sha) or release.get("target_commitish") != sha:
        raise ValueError("Release tag identity mismatch / 发布标签标识不匹配")
    git("merge-base", "--is-ancestor", sha, "HEAD")
    with tempfile.TemporaryDirectory(prefix="uf-release-tag-") as directory:
        root = Path(directory)
        for name in VERSION_FILES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(git("show", f"{sha}:{name}"), encoding="utf-8")
        if check_versions(root) != version:
            raise ValueError("Tagged release version mismatch / 标签发布版本不匹配")

    if not registry_present:
        # Provenance names the workflow commit, so its npm source must match the tag. / 来源证明指向工作流提交，因此其 npm 源码必须与标签一致。
        git("diff", "--quiet", sha, "HEAD", "--", "npm")
    if fetch_tag(tag, git=git) != sha:
        raise ValueError("Release tag changed before recovery / 恢复前发布标签已变化")
    stage(tag, gh=gh, expected_release_id=release["id"], expected_tag_sha=sha)
    if fetch_tag(tag, git=git) != sha:
        raise ValueError("Release tag changed during recovery / 恢复期间发布标签已变化")
    if registry_present or npm(version):
        return None
    return {"tag": tag, "sha": sha}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = recover_release(check_versions(Path.cwd()))
        with args.output.open("a", encoding="utf-8") as output:
            if result is None:
                output.write("needed=false\n")
            else:
                output.write(f"needed=true\ntag={result['tag']}\nsha={result['sha']}\n")
    except (KeyError, ValueError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release recovery failed / 发布恢复失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
