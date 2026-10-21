"""Attach to the existing native browser. / 连接已启动的原生浏览器。"""
import unittest
from unittest.mock import MagicMock, patch

from webdriver_client import WebDriver


class NativeAttachTest(unittest.TestCase):
    def test_fresh_workspace_creates_tab_with_native_click(self):
        driver = WebDriver.__new__(WebDriver)
        driver.session = "fixture"
        driver.wait_script = MagicMock()
        driver.request = MagicMock(side_effect=[[{"element-6066-11e4-a52e-4f735466cecf": "new-tab"}], None])
        driver.open_editor("New query")
        self.assertEqual(driver.request.call_args_list[-1].args, ("POST", "/session/fixture/element/new-tab/click", {}))

    def test_restored_editor_does_not_create_another_tab(self):
        driver = WebDriver.__new__(WebDriver)
        driver.session = "fixture"
        driver.wait_script = MagicMock()
        driver.request = MagicMock(return_value=[])
        driver.open_editor("New script")
        driver.request.assert_called_once()

    def test_session_attaches_without_launching_another_application(self):
        with patch.object(WebDriver, "request", side_effect=[{"sessionId": "fixture"}, None]) as request:
            driver = WebDriver("127.0.0.1:9222")
        self.assertEqual(driver.session, "fixture")
        self.assertEqual(request.call_args_list[0].args, (
            "POST", "/session", {"capabilities": {"alwaysMatch": {
                "browserName": "webview2", "ms:edgeChromium": True,
                "ms:edgeOptions": {"debuggerAddress": "127.0.0.1:9222"},
            }}},
        ))
