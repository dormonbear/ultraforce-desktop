"""Validate the synthetic CLI wire format and privacy guard. / 验证合成 CLI 协议格式及隐私约束。"""
import json
import os
from pathlib import Path
from sf_fixture import ORG, ORG_ID, native_auth
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


class NativeFixtureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="uf-native-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "synthetic-only").touch()
        self.environment = {
            **os.environ, "UF_NATIVE_FIXTURE": str(self.root),
            **{flag: "true" for flag in [
                "SF_DISABLE_TELEMETRY", "SFDX_DISABLE_TELEMETRY", "SF_DISABLE_LOG_FILE", "SFDX_DISABLE_LOG_FILE",
            ]},
        }

    def invoke(self, args, mode="normal", overrides=None):
        (self.root / "mode").write_text(mode, encoding="utf-8")
        return subprocess.run([
            sys.executable, str(Path(__file__).with_name("sf_fixture.py")), *args,
        ], env={**self.environment, **(overrides or {})}, capture_output=True, encoding="utf-8", check=False)

    def test_raw_rest_results_are_not_wrapped_in_cli_envelopes(self):
        for route, key in [("tooling/completions?type=apex", "publicDeclarations"), ("composite", "compositeResponse")]:
            result = self.invoke(["api", "request", "rest", "/services/data/v60.0/" + route])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(key, json.loads(result.stdout))
            self.assertNotIn("result", json.loads(result.stdout))

    def test_metadata_queries_are_complete_cli_envelopes(self):
        result = self.invoke(["data", "query", "--query", "SELECT Name FROM ApexClass", "--json"])
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], 0)
        self.assertTrue(payload["result"]["done"])
        self.assertEqual(payload["result"]["totalSize"], len(payload["result"]["records"]))
        self.assertEqual(payload["result"]["records"][0]["Name"], "NativeService")

    def test_identity_resolves_alias_but_metadata_requires_the_pinned_username(self):
        identity = self.invoke(["org", "display", "--target-org", "NativeFixture", "--json"])
        self.assertEqual(identity.returncode, 0, identity.stderr)
        value = json.loads(identity.stdout)["result"]
        self.assertEqual((value["id"], value["username"]), (ORG_ID, ORG))
        for target, status in [("NativeFixture", 1), (ORG, 0)]:
            result = self.invoke(["sobject", "list", "--sobject", "all", "--target-org", target, "--json"])
            self.assertEqual(result.returncode, status, result.stdout)

    def test_offline_and_stdlib_failures_are_actual_nonzero_commands(self):
        query = ["data", "query", "--query", "SELECT Name FROM ApexClass"]
        offline = self.invoke(query, "offline")
        self.assertEqual(offline.returncode, 1)
        self.assertEqual(json.loads(offline.stdout)["status"], 1)
        failed = self.invoke(["api", "request", "rest", "tooling/completions?type=apex"], "stdlib-error")
        self.assertEqual(failed.returncode, 1)
        self.assertIn("Synthetic Tooling stdlib failure", json.loads(failed.stdout)["message"])
        self.assertEqual(self.invoke(query, "stdlib-error").returncode, 0)

    def test_privacy_flags_and_unknown_commands_fail_closed(self):
        for flag in ["SF_DISABLE_TELEMETRY", "SFDX_DISABLE_TELEMETRY", "SF_DISABLE_LOG_FILE", "SFDX_DISABLE_LOG_FILE"]:
            with self.subTest(flag=flag):
                result = self.invoke(["--version"], overrides={flag: "false"})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(flag, result.stderr)
        self.assertEqual(self.invoke(["unexpected", "command"]).returncode, 1)
        self.assertEqual(self.invoke(["org", "auth", "show-access-token", "--target-org", ORG]).returncode, 1)

    def test_rest_auth_requires_an_explicit_loopback_endpoint(self):
        for address in ("https://example.invalid", "http://example.invalid:8080",
                        "http://127.0.0.1", "http://127.0.0.1:bad",
                        "http://token@127.0.0.1:8080", "http://127.0.0.1:8080/private"):
            with self.subTest(address=address):
                (self.root / "rest-url").write_text(address, encoding="utf-8")
                result = self.invoke(["org", "display", "--target-org", ORG, "--json"])
                self.assertEqual(result.returncode, 1)
                self.assertIn("loopback", json.loads(result.stdout)["message"])
        (self.root / "rest-url").write_text("http://127.0.0.1:8080", encoding="utf-8")
        result = self.invoke(["org", "display", "--target-org", ORG, "--json"])
        self.assertEqual(result.returncode, 0, result.stderr)
        value = json.loads(result.stdout)["result"]
        self.assertEqual(value["instanceUrl"], "http://127.0.0.1:8080")
        self.assertNotIn("accessToken", value)
        token = self.invoke(["org", "auth", "show-access-token", "--target-org", ORG, "--json"])
        self.assertEqual(token.returncode, 0, token.stderr)
        self.assertEqual(json.loads(token.stdout)["result"]["accessToken"], "synthetic-native-token")
        self.assertEqual(self.invoke(["org", "auth", "show-access-token", "--target-org", ORG], "offline").returncode, 1)

    def test_auth_barrier_blocks_a_real_fixture_process_until_release(self):
        (self.root / "mode").write_text("normal", encoding="utf-8")
        (self.root / "rest-url").write_text("http://127.0.0.1:8080", encoding="utf-8")
        (self.root / "block-auth").touch()
        process = subprocess.Popen([
            sys.executable, str(Path(__file__).with_name("sf_fixture.py")),
            "org", "auth", "show-access-token", "--target-org", ORG, "--json",
        ], env=self.environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8")
        try:
            deadline = time.monotonic() + 5
            while not (self.root / "auth-entered").exists():
                self.assertIsNone(process.poll())
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.assertIsNone(process.poll())
        finally:
            (self.root / "release-auth").touch()
            try:
                output, error = process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)
                raise
        self.assertEqual(process.returncode, 0, error)
        self.assertEqual(json.loads(output)["result"]["accessToken"], "synthetic-native-token")

    def test_expired_auth_barrier_leaves_a_failure_marker(self):
        (self.root / "rest-url").write_text("http://127.0.0.1:8080", encoding="utf-8")
        (self.root / "block-auth").touch()
        with patch("sf_fixture.time.monotonic", side_effect=[0, 16]):
            with self.assertRaisesRegex(RuntimeError, "barrier expired"):
                native_auth(self.root, ["org", "auth", "show-access-token", "--target-org", ORG], {})
        self.assertTrue((self.root / "auth-expired").is_file())


if __name__ == "__main__":
    unittest.main()
