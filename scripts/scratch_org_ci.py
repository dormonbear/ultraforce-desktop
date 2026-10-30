#!/usr/bin/env python3
"""Run live integration tests only on a disposable CI scratch org.

仅在一次性 CI 临时组织中运行真实集成测试。
"""

import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "scratch-org"
SECRET = "UF_SCRATCH_CI_DEV_HUB_AUTH_URL"
PRIVACY = {
    "SF_DISABLE_TELEMETRY": "true",
    "SFDX_DISABLE_TELEMETRY": "true",
    "SF_DISABLE_LOG_FILE": "true",
    "SFDX_DISABLE_LOG_FILE": "true",
    "SF_AUTOUPDATE_DISABLE": "true",
    "SFDX_AUTOUPDATE_DISABLE": "true",
}


class StageFailure(Exception):
    pass


def run_stage(name, args, env, *, cwd=ROOT, input_text=None, timeout=120, visible=False):
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            env=env,
            input=input_text,
            text=True,
            stdout=None if visible else subprocess.PIPE,
            stderr=None if visible else subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise StageFailure(f"{name}: timed out / 超时") from None
    except OSError:
        raise StageFailure(f"{name}: could not start / 无法启动") from None
    if result.returncode != 0:
        raise StageFailure(f"{name}: exit {result.returncode} / 退出码 {result.returncode}")


def run(environment):
    env = dict(environment)
    if not (
        env.get("GITHUB_ACTIONS") == "true"
        and env.get("GITHUB_REPOSITORY") == "dormonbear/ultraforce-desktop"
        and env.get("GITHUB_REF") == "refs/heads/main"
        and env.get("GITHUB_EVENT_NAME") in {"workflow_dispatch", "schedule"}
    ):
        print(
            "Scratch CI requires a trusted main-branch run. / 临时组织 CI 需要可信的主线运行。",
            file=sys.stderr,
        )
        return 1
    auth = env.pop(SECRET, "")
    if not auth.strip():
        print("Dev Hub credential is not configured. / 未配置 Dev Hub 凭据。", file=sys.stderr)
        return 1

    env.update(PRIVACY)
    run_id = uuid.uuid4().hex
    hub = f"uf-ci-hub-{run_id}"
    scratch = f"uf-ci-scratch-{run_id}"
    attempted_create = False
    failed = False
    try:
        run_stage(
            "Dev Hub login / Dev Hub 登录",
            ["sf", "org", "login", "sfdx-url", "--alias", hub, "--sfdx-url-stdin"],
            env,
            input_text=auth + "\n",
        )
        auth = None
        attempted_create = True
        run_stage(
            "scratch creation / 创建临时组织",
            ["sf", "org", "create", "scratch", "--edition", "developer",
             "--target-dev-hub", hub, "--alias", scratch, "--duration-days", "1",
             "--wait", "20", "--no-track-source", "--no-namespace"],
            env,
            cwd=FIXTURE,
            timeout=25 * 60,
        )
        run_stage(
            "fixture deployment / 部署夹具",
            ["sf", "project", "deploy", "start", "--source-dir", "force-app",
             "--target-org", scratch, "--wait", "10"],
            env,
            cwd=FIXTURE,
            timeout=12 * 60,
        )
        run_stage(
            "synthetic Account / 合成 Account",
            ["sf", "data", "create", "record", "--sobject", "Account", "--values",
             "Name='UltraForce synthetic CI'", "--target-org", scratch],
            env,
        )
        test_env = dict(env, UF_E2E_ORG=scratch)
        run_stage(
            "live tests / 真实测试",
            ["cargo", "test", "--locked", "-p", "features", "--test", "real_org_e2e",
             "--", "--ignored", "--test-threads=1"],
            test_env,
            timeout=45 * 60,
            visible=True,
        )
    except StageFailure as failure:
        print(f"Scratch CI failed at {failure}. / 临时组织 CI 失败：{failure}。", file=sys.stderr)
        failed = True
    finally:
        if attempted_create:
            try:
                run_stage(
                    "scratch cleanup / 清理临时组织",
                    ["sf", "org", "delete", "scratch", "--target-org", scratch, "--no-prompt"],
                    env,
                    timeout=3 * 60,
                )
            except StageFailure as failure:
                print(
                    f"Scratch cleanup failed ({failure}); the org was requested with a one-day expiry. / "
                    f"清理临时组织失败（{failure}）；该组织请求时设置了一天有效期。",
                    file=sys.stderr,
                )
                failed = True
    if not failed:
        print("Scratch-org integration tests passed and cleanup succeeded. / 临时组织集成测试通过，且清理成功。")
    return int(failed)


if __name__ == "__main__":
    sys.exit(run(os.environ))
