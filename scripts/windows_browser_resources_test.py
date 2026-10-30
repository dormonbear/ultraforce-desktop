"""Check privacy and failure handling for CI socket summaries. / 检查 CI socket 汇总的隐私及失败处理。"""

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from report_windows_browser_resources import POWERSHELL, STATES, collect_counts, main


def counts():
    return {state: index for index, state in enumerate(STATES)}


class BrowserResourceSummaryTest(unittest.TestCase):
    def test_collects_only_named_state_counts(self):
        calls = []
        def run(command, **options):
            calls.append((command, options))
            return subprocess.CompletedProcess(command, 0, json.dumps(counts()), "")
        self.assertEqual(collect_counts(runner=run), counts())
        command, options = calls[0]
        self.assertEqual(command[:3], ["powershell.exe", "-NoProfile", "-NonInteractive"])
        self.assertEqual(options["timeout"], 30)
        self.assertTrue(options["capture_output"])

    def test_rejects_unexpected_fields_and_invalid_counts(self):
        for value in ({**counts(), "remoteAddress": "private.example.invalid"},
                      {**counts(), STATES[0]: -1}, {**counts(), STATES[0]: True},
                      {**counts(), STATES[0]: "3"}, {}, []):
            with self.subTest(value=value), self.assertRaises(ValueError):
                collect_counts(runner=lambda args, **_kw: subprocess.CompletedProcess(args, 0, json.dumps(value), ""))

    def test_rejects_invalid_json_and_failed_powershell(self):
        for code, output in ((0, "private.example.invalid"), (1, json.dumps(counts()))):
            with self.subTest(code=code), self.assertRaises(ValueError):
                collect_counts(runner=lambda args, **_kw: subprocess.CompletedProcess(args, code, output, "private.example.invalid"))

    def test_skips_non_github_or_non_windows_environments_without_querying(self):
        for env in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_OS": "macOS"},
                    {"GITHUB_ACTIONS": "false", "RUNNER_OS": "Windows"}):
            def unexpected(): self.fail("Unexpected socket query / 不应查询 socket")
            with self.subTest(env=env), redirect_stdout(io.StringIO()):
                self.assertEqual(main(environment=env, collector=unexpected), 0)

    def test_success_prints_only_aggregate_counts(self):
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(environment={"GITHUB_ACTIONS": "true", "RUNNER_OS": "Windows"}, collector=counts)
        self.assertEqual(result, 0)
        lines = output.getvalue().splitlines()
        self.assertIn("连接状态", lines[0])
        self.assertEqual(lines[1:], [f"{state}: {counts()[state]}" for state in STATES])

    def test_unavailable_summary_fails_without_printing_raw_errors(self):
        for error in (ValueError("private.example.invalid"), OSError("private.example.invalid"),
                      subprocess.TimeoutExpired("private.example.invalid", 30)):
            out, err = io.StringIO(), io.StringIO()
            def fail(): raise error
            with self.subTest(error=type(error).__name__), redirect_stdout(out), redirect_stderr(err):
                result = main(environment={"GITHUB_ACTIONS": "true", "RUNNER_OS": "Windows"}, collector=fail)
                self.assertEqual(result, 1)
                self.assertIn("不可用", err.getvalue())
                self.assertNotIn("private.example.invalid", out.getvalue() + err.getvalue())

    def test_invalid_collector_result_is_not_printed(self):
        out, err = io.StringIO(), io.StringIO()
        value = {**counts(), STATES[0]: "private.example.invalid"}
        with redirect_stdout(out), redirect_stderr(err):
            result = main(environment={"GITHUB_ACTIONS": "true", "RUNNER_OS": "Windows"}, collector=lambda: value)
        self.assertEqual(result, 1)
        self.assertNotIn("private.example.invalid", out.getvalue() + err.getvalue())
        self.assertIn("不可用", err.getvalue())

    def test_ci_limits_summary_to_a_failed_windows_browser_step(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        browser = workflow.split("      - name: Production browser regressions / 正式构建浏览器回归\n", 1)[1]
        browser, summary = browser.split("      - name: Windows browser resource summary / Windows 浏览器资源汇总\n", 1)
        summary = summary.split("\n      - name:", 1)[0]
        self.assertIn("id: production_browser", browser)
        for condition in ("failure()", "runner.os == 'Windows'", "steps.production_browser.outcome == 'failure'"):
            self.assertIn(condition, summary)
        self.assertIn("python scripts/report_windows_browser_resources.py", summary)

    def test_cli_writes_bilingual_output_with_windows_legacy_encoding(self):
        script = Path(__file__).with_name("report_windows_browser_resources.py")
        env = {**os.environ, "PYTHONIOENCODING": "cp1252", "GITHUB_ACTIONS": "false", "RUNNER_OS": "Windows"}
        result = subprocess.run([sys.executable, str(script)], env=env, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("已跳过", result.stdout.decode("utf-8"))

    @unittest.skipUnless(os.name == "nt", "PowerShell runs on Windows / 在 Windows 运行 PowerShell")
    def test_powershell_counts_synthetic_states_without_printing_connection_details(self):
        source = """
function Get-NetTCPConnection {
    [PSCustomObject]@{ State='TimeWait'; LocalAddress='private.example.invalid'; LocalPort=43210; OwningProcess=123456 }
    [PSCustomObject]@{ State='TimeWait'; LocalAddress='private.example.invalid'; LocalPort=43210; OwningProcess=123456 }
    [PSCustomObject]@{ State='Established'; LocalAddress='private.example.invalid'; LocalPort=43210; OwningProcess=123456 }
}
""" + POWERSHELL
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", source],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = {state: 0 for state in STATES}
        expected.update(TimeWait=2, Established=1)
        self.assertEqual(json.loads(result.stdout), expected)
        for secret in ("private.example.invalid", "43210", "123456"):
            self.assertNotIn(secret, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
