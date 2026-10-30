import contextlib
import io
import re
import subprocess
import unittest
from unittest import mock

import scratch_org_ci as scratch


def trusted_env():
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "dormonbear/ultraforce-desktop",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        scratch.SECRET: "synthetic-secret",
        "SF_DISABLE_TELEMETRY": "false",
        "SFDX_DISABLE_TELEMETRY": "false",
    }


class ScratchCiTests(unittest.TestCase):
    def execute(self, env, effect):
        output = io.StringIO()
        with mock.patch.object(scratch.subprocess, "run", side_effect=effect) as runner, \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            status = scratch.run(env)
        return status, runner.call_args_list, output.getvalue()

    def test_workflow_pins_a_cli_without_the_redaction_override(self):
        workflow = (scratch.ROOT / ".github" / "workflows" / "scratch-org-e2e.yml").read_text(encoding="utf-8")
        pinned = re.search(r"npm install --global @salesforce/cli@(\d+)\.(\d+)\.(\d+)(?:\s|$)", workflow)
        self.assertIsNotNone(pinned, "Scratch CI must pin a CLI version / 临时组织 CI 必须固定 CLI 版本")
        self.assertGreaterEqual(tuple(map(int, pinned.groups())), (2, 156, 8))

    def test_rejects_untrusted_context_or_missing_credential(self):
        for changes in (
            {"GITHUB_ACTIONS": "false"},
            {"GITHUB_REPOSITORY": "other/repository"},
            {"GITHUB_REF": "refs/heads/feature"},
            {"GITHUB_EVENT_NAME": "pull_request"},
            {scratch.SECRET: " "},
        ):
            with self.subTest(changes=changes):
                env = trusted_env()
                env.update(changes)
                status, calls, output = self.execute(env, lambda *a, **k: self.fail("must not run"))
                self.assertEqual(status, 1)
                self.assertEqual(calls, [])
                self.assertNotIn("synthetic-secret", output)

    def test_success_uses_only_generated_scratch_and_scrubs_secret(self):
        status, calls, output = self.execute(
            trusted_env(), lambda args, **kwargs: subprocess.CompletedProcess(args, 0)
        )
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 6)
        commands = [call.args[0] for call in calls]
        login, create, deploy, seed, tests, cleanup = commands
        hub = login[login.index("--alias") + 1]
        target = create[create.index("--alias") + 1]
        self.assertTrue(hub.startswith("uf-ci-hub-"))
        self.assertTrue(target.startswith("uf-ci-scratch-"))
        self.assertEqual(create[create.index("--target-dev-hub") + 1], hub)
        self.assertEqual(create[create.index("--duration-days") + 1], "1")
        self.assertIn("--no-track-source", create)
        self.assertIn("--no-namespace", create)
        for command in (deploy, seed, cleanup):
            self.assertEqual(command[command.index("--target-org") + 1], target)
        self.assertEqual(calls[4].kwargs["env"]["UF_E2E_ORG"], target)
        self.assertIn("--ignored", tests)
        self.assertEqual(calls[0].kwargs["input"], "synthetic-secret\n")
        self.assertTrue(all(c.kwargs["input"] is None for c in calls[1:]))
        for call in calls:
            self.assertNotIn("synthetic-secret", str(call.args))
            self.assertNotIn(scratch.SECRET, call.kwargs["env"])
            for flag, value in scratch.PRIVACY.items():
                self.assertEqual(call.kwargs["env"][flag], value)
        self.assertNotIn("synthetic-secret", output)

    def test_every_failure_keeps_failure_and_attempts_cleanup_after_creation_starts(self):
        for failed_index in range(6):
            with self.subTest(failed_index=failed_index):
                index = 0

                def command(args, **kwargs):
                    nonlocal index
                    current = index
                    index += 1
                    return subprocess.CompletedProcess(args, 17 if current == failed_index else 0,
                                                       "synthetic-secret", "synthetic-secret")

                status, calls, output = self.execute(trusted_env(), command)
                self.assertEqual(status, 1)
                self.assertNotIn("synthetic-secret", output)
                self.assertIn("exit 17", output)
                if failed_index == 0:
                    self.assertEqual(len(calls), 1)
                else:
                    self.assertEqual(calls[-1].args[0][:4], ["sf", "org", "delete", "scratch"])

    def test_timeout_attempts_cleanup_and_remains_failed(self):
        def command(args, **kwargs):
            if args[:4] == ["sf", "project", "deploy", "start"]:
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
            return subprocess.CompletedProcess(args, 0)

        status, calls, output = self.execute(trusted_env(), command)
        self.assertEqual(status, 1)
        self.assertIn("timed out", output)
        self.assertEqual(calls[-1].args[0][:4], ["sf", "org", "delete", "scratch"])

    def test_interruption_after_creation_still_attempts_cleanup(self):
        def command(args, **kwargs):
            if args[:4] == ["sf", "project", "deploy", "start"]:
                raise KeyboardInterrupt()
            return subprocess.CompletedProcess(args, 0)

        with mock.patch.object(scratch.subprocess, "run", side_effect=command) as runner:
            with self.assertRaises(KeyboardInterrupt):
                scratch.run(trusted_env())
        self.assertEqual(runner.call_args_list[-1].args[0][:4], ["sf", "org", "delete", "scratch"])


if __name__ == "__main__":
    unittest.main()
