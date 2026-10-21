"""Hosted policy restoration and privacy boundary. / 托管策略恢复及隐私边界。"""
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from webview_policy import webview_policy


class WebViewPolicyTest(unittest.TestCase):
    def test_local_and_self_hosted_policy_changes_are_rejected(self):
        for actions, runner in [("false", "github-hosted"), ("true", "self-hosted")]:
            with self.subTest(runner=runner):
                with patch("webview_policy.os.name", "nt"), patch.dict(os.environ, {
                    "GITHUB_ACTIONS": actions, "RUNNER_ENVIRONMENT": runner,
                }):
                    with self.assertRaisesRegex(RuntimeError, "hosted Windows CI"):
                        with webview_policy("unused.exe", {}):
                            self.fail("Unexpected policy access / 意外访问策略")

    def test_restores_existing_values_and_removes_created_values_after_failure(self):
        registry = MagicMock()
        registry.KEY_SET_VALUE = 2
        registry.KEY_QUERY_VALUE = 1
        registry.KEY_WOW64_64KEY = 256
        registry.REG_SZ = 1
        registry.QueryValueEx.side_effect = [("previous", 1), FileNotFoundError()]
        with patch.dict(sys.modules, {"winreg": registry}), patch("webview_policy.os.name", "nt"), patch.dict(os.environ, {
            "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
        }):
            with self.assertRaisesRegex(RuntimeError, "fixture failure"):
                with webview_policy("fixture.exe", {"AdditionalBrowserArguments": "temporary", "UserDataFolder": "owned"}):
                    raise RuntimeError("fixture failure / 夹具失败")
        key = registry.CreateKeyEx.return_value.__enter__.return_value
        registry.DeleteValue.assert_called_once_with(key, "fixture.exe")
        self.assertEqual(registry.SetValueEx.call_args_list[-1].args, (key, "fixture.exe", 0, 1, "previous"))
