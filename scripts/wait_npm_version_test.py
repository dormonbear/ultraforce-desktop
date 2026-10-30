"""Verify npm propagation without publishing. / 验证 npm 同步而不执行发布。"""

import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from wait_npm_version import npm_latest_is, wait_for_publication


class Clock:
    def __init__(self):
        self.now = 0
        self.sleeps = []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class NpmPropagationTest(unittest.TestCase):
    def test_waits_for_explicit_version_then_latest_and_rechecks_both(self):
        clock = Clock()
        explicit = iter((False, False, True, True))
        latest = iter((False, True))
        calls = []
        def has_version(version):
            calls.append(("version", version))
            return next(explicit)
        def is_latest(version):
            calls.append(("latest", version))
            return next(latest)
        wait_for_publication("1.2.3", has_version=has_version, is_latest=is_latest,
                             clock=clock.clock, sleep=clock.sleep, timeout=30, interval=5)
        self.assertEqual([name for name, _ in calls], ["version", "version", "version", "latest", "version", "latest"])
        self.assertEqual(clock.sleeps, [5, 5, 5])

    def test_real_npm_response_parsers_handle_the_observed_propagation_sequence(self):
        clock = Clock()
        responses = iter((
            (1, '{"error":{"code":"E404"}}'),
            (0, '"1.2.3"'), (0, '"1.2.2"'),
            (0, '"1.2.3"'), (0, '"1.2.3"'),
        ))
        calls = []
        def npm(args, **_kwargs):
            calls.append(args[2])
            code, output = next(responses)
            return subprocess.CompletedProcess(args, code, output, "")
        with patch("wait_npm_version.bounded_npm", side_effect=npm):
            wait_for_publication("1.2.3", clock=clock.clock, sleep=clock.sleep, timeout=30, interval=5)
        self.assertEqual(calls, ["@dormon/ultraforce-mcp@1.2.3", "@dormon/ultraforce-mcp@1.2.3",
                                 "@dormon/ultraforce-mcp@latest", "@dormon/ultraforce-mcp@1.2.3",
                                 "@dormon/ultraforce-mcp@latest"])
        self.assertEqual(clock.sleeps, [5, 5])

    def test_timeout_is_bounded_and_never_hides_missing_version(self):
        clock = Clock()
        with self.assertRaises(TimeoutError):
            wait_for_publication("1.2.3", has_version=lambda _version: False,
                                 is_latest=lambda _version: self.fail("Unexpected latest lookup / 不应查询 latest"),
                                 clock=clock.clock, sleep=clock.sleep, timeout=10, interval=5)
        self.assertEqual(clock.sleeps, [5, 5])

    def test_registry_errors_fail_immediately(self):
        clock = Clock()
        def fail(_version): raise ValueError("Synthetic registry error / 合成注册表错误")
        with self.assertRaises(ValueError):
            wait_for_publication("1.2.3", has_version=fail, clock=clock.clock, sleep=clock.sleep)
        self.assertEqual(clock.sleeps, [])
        with self.assertRaises(ValueError):
            wait_for_publication("1.2.3", has_version=lambda _version: True, is_latest=fail,
                                 clock=clock.clock, sleep=clock.sleep)
        self.assertEqual(clock.sleeps, [])

    def test_old_latest_times_out_and_rechecks_explicit_version(self):
        clock = Clock()
        calls = []
        def visible(_version): calls.append("version"); return True
        def stale(_version): calls.append("latest"); return False
        with self.assertRaises(TimeoutError):
            wait_for_publication("1.2.3", has_version=visible, is_latest=stale,
                                 clock=clock.clock, sleep=clock.sleep, timeout=10, interval=5)
        self.assertEqual(calls, ["version", "latest"] * 3)
        self.assertEqual(clock.sleeps, [5, 5])

    def test_invalid_version_never_queries_or_sleeps(self):
        clock = Clock()
        with self.assertRaises(ValueError):
            wait_for_publication("1.2.3-rc.1", has_version=lambda _version: self.fail("Unexpected query / 不应查询注册表"),
                                 clock=clock.clock, sleep=clock.sleep)
        self.assertEqual(clock.sleeps, [])
        for timeout, interval in ((0, 5), (5, 0)):
            with self.subTest(timeout=timeout, interval=interval), self.assertRaises(ValueError):
                wait_for_publication("1.2.3", has_version=lambda _version: self.fail("Unexpected query / 不应查询注册表"),
                                     clock=clock.clock, sleep=clock.sleep, timeout=timeout, interval=interval)

    def test_latest_only_accepts_valid_registry_responses(self):
        def runner(code, value):
            def run(args, **_kwargs):
                self.assertIn("@dormon/ultraforce-mcp@latest", args)
                self.assertIn("https://registry.npmjs.org", args)
                return subprocess.CompletedProcess(args, code, value, "")
            return run
        self.assertTrue(npm_latest_is("1.2.3", runner=runner(0, '"1.2.3"')))
        self.assertFalse(npm_latest_is("1.2.3", runner=runner(0, '"1.2.2"')))
        self.assertFalse(npm_latest_is("1.2.3", runner=runner(1, json.dumps({"error": {"code": "E404"}}))))
        for code, value in ((0, '"bad version"'), (1, '{"error":{"code":"E500"}}'), (1, "network error")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                npm_latest_is("1.2.3", runner=runner(code, value))

    def test_workflow_waits_after_either_attempted_npm_publish(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn("  verify-npm-propagation:\n", workflow)
        job = workflow.split("  verify-npm-propagation:\n", 1)[1].split("\n  #", 1)[0]
        self.assertIn("needs: [publish-npm, recover-npm]", job)
        self.assertIn("always()", job)
        self.assertIn("!cancelled()", job)
        self.assertIn("needs.publish-npm.result == 'success'", job)
        self.assertIn("needs.publish-npm.result == 'failure'", job)
        self.assertIn("needs.recover-npm.result == 'success'", job)
        self.assertIn("needs.recover-npm.result == 'failure'", job)
        self.assertIn("python scripts/wait_npm_version.py", job)


if __name__ == "__main__":
    unittest.main()
