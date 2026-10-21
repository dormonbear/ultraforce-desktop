"""Desktop capture privacy boundary. / 桌面截图隐私边界。"""
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from startup_diagnostics import capture_desktop


class CapturePrivacyTest(unittest.TestCase):
    def test_local_and_self_hosted_desktops_are_never_captured(self):
        for actions, runner in [("false", "github-hosted"), ("true", "self-hosted"), ("true", "")]:
            with self.subTest(actions=actions, runner=runner):
                with patch.dict(os.environ, {"GITHUB_ACTIONS": actions, "RUNNER_ENVIRONMENT": runner}):
                    with patch("startup_diagnostics.subprocess.run") as execute:
                        self.assertFalse(capture_desktop(Path("unused.png")))
                        execute.assert_not_called()
