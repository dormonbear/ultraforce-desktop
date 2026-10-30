"""Wait for npm publication to propagate. / 等待 npm 发布同步完成。"""

import json
from pathlib import Path
import re
import subprocess
import sys
import time

from check_release_versions import check_versions
from recover_release import npm_has_version


STABLE_VERSION = r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
REGISTRY_VERSION = STABLE_VERSION + r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"


def bounded_npm(*args, **kwargs):
    return subprocess.run(*args, timeout=20, **kwargs)


def npm_latest_is(version: str, *, runner=subprocess.run) -> bool:
    result = runner(
        ["npm", "view", "@dormon/ultraforce-mcp@latest", "version", "--json",
         "--prefer-online", "--registry", "https://registry.npmjs.org"],
        capture_output=True, encoding="utf-8", check=False,
    )
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ValueError("Could not verify npm latest / 无法验证 npm 最新版本") from error
    if result.returncode == 0 and isinstance(value, str) and re.fullmatch(REGISTRY_VERSION, value):
        return value == version
    if (result.returncode != 0 and isinstance(value, dict)
            and isinstance(value.get("error"), dict) and value["error"].get("code") == "E404"):
        return False
    raise ValueError("Could not verify npm latest / 无法验证 npm 最新版本")


def wait_for_publication(
    version: str, *,
    has_version=lambda value: npm_has_version(value, runner=bounded_npm),
    is_latest=lambda value: npm_latest_is(value, runner=bounded_npm),
    clock=time.monotonic, sleep=time.sleep, timeout: float = 300, interval: float = 10,
) -> None:
    if not re.fullmatch(STABLE_VERSION, version) or timeout <= 0 or interval <= 0:
        raise ValueError("Invalid npm propagation settings / npm 同步参数无效")
    deadline = clock() + timeout
    while True:
        visible = has_version(version)
        if type(visible) is not bool:
            raise ValueError("Invalid npm version response / npm 版本响应无效")
        if visible:
            latest = is_latest(version)
            if type(latest) is not bool:
                raise ValueError("Invalid npm latest response / npm 最新版本响应无效")
            if latest:
                return
        remaining = deadline - clock()
        if remaining <= 0:
            raise TimeoutError("npm version did not propagate in time / npm 版本未能及时同步")
        sleep(min(interval, remaining))


def main() -> int:
    try:
        version = check_versions(Path.cwd())
        wait_for_publication(version)
        print(f"npm {version} and latest are visible / npm {version} 及 latest 已可见")
    except (KeyError, ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        print(f"npm propagation check failed / npm 同步检查失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
