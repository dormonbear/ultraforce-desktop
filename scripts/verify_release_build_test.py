"""Check build preflight using a synthetic local Git remote. / 使用合成本地 Git 远程测试构建前检查。"""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from verify_release_build import verify_release_build


class VerifyReleaseBuildTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="uf-release-git-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.remote = root / "remote.git"
        self.work = root / "work"
        subprocess.run(["git", "init", "--bare", str(self.remote)], check=True, capture_output=True)
        subprocess.run(["git", "init", "--initial-branch=main", str(self.work)], check=True, capture_output=True)
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture")
        self.git("-c", "tag.gpgSign=false", "tag", "v1.2.3")
        self.git("remote", "add", "origin", str(self.remote))
        self.git("push", "origin", "HEAD:refs/heads/main", "refs/tags/v1.2.3")
        self.release = {"tagName": "v1.2.3", "isDraft": True, "isPrerelease": False}
        self.calls = []

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.work, check=True, capture_output=True, encoding="utf-8").stdout

    def execute(self, *args):
        self.calls.append(args)
        if args[0] == "gh":
            return json.dumps(self.release)
        return self.git(*args[1:])

    def test_matching_draft_and_real_local_tag_are_accepted(self):
        verify_release_build("v1.2.3", execute=self.execute)
        self.assertTrue(any(call[:2] == ("git", "fetch") for call in self.calls))

    def test_non_draft_prerelease_or_wrong_identity_stops_before_git(self):
        for field, value in [("isDraft", False), ("isPrerelease", True), ("tagName", "v1.2.4")]:
            with self.subTest(field=field):
                original = self.release[field]
                self.release[field] = value
                self.calls.clear()
                with self.assertRaises(ValueError):
                    verify_release_build("v1.2.3", execute=self.execute)
                self.assertFalse(any(call[0] == "git" for call in self.calls))
                self.release[field] = original

    def test_existing_tag_pointing_to_a_different_commit_is_rejected(self):
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "later fixture")
        with self.assertRaises(ValueError):
            verify_release_build("v1.2.3", execute=self.execute)

    def test_missing_remote_tag_is_rejected(self):
        self.release["tagName"] = "v1.2.4"
        with self.assertRaises(subprocess.CalledProcessError):
            verify_release_build("v1.2.4", execute=self.execute)

    def test_invalid_tag_never_invokes_commands(self):
        with self.assertRaises(ValueError):
            verify_release_build("v1.2.3-rc.1", execute=self.execute)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
