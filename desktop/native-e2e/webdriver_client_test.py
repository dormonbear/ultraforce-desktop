"""Attach to the existing native browser. / 连接已启动的原生浏览器。"""
import unittest
from unittest.mock import MagicMock, patch

from webdriver_client import WebDriver, key_actions


class NativeAttachTest(unittest.TestCase):
    def test_cursor_navigation_does_not_click_and_reset_selection(self):
        driver = WebDriver.__new__(WebDriver)
        driver.session = "fixture"
        driver.wait_script = MagicMock()
        driver.execute = MagicMock(return_value={"element-6066-11e4-a52e-4f735466cecf": "editor"})
        driver.request = MagicMock()
        driver.editor_keys("\ue012", focus=False)
        driver.request.assert_called_once()
        self.assertEqual(driver.request.call_args.args[1], "/session/fixture/actions")

    def test_native_keys_hold_and_release_control_without_textarea(self):
        self.assertEqual(key_actions("\ue009a\ue000X"), [
            {"type": "keyDown", "value": "\ue009"},
            {"type": "keyDown", "value": "a"}, {"type": "keyUp", "value": "a"},
            {"type": "keyUp", "value": "\ue009"},
            {"type": "keyDown", "value": "X"}, {"type": "keyUp", "value": "X"},
        ])
        self.assertEqual(key_actions("\ue009")[-1], {"type": "keyUp", "value": "\ue009"})

    def test_editor_receives_native_focus_and_w3c_actions(self):
        driver = WebDriver.__new__(WebDriver)
        driver.session = "fixture"
        driver.wait_script = MagicMock()
        driver.execute = MagicMock(return_value={"element-6066-11e4-a52e-4f735466cecf": "editor"})
        driver.request = MagicMock()
        driver.editor_keys("X")
        self.assertEqual(driver.request.call_args_list[0].args, ("POST", "/session/fixture/element/editor/click", {}))
        self.assertEqual(driver.request.call_args_list[1].args, ("POST", "/session/fixture/actions", {
            "actions": [{"type": "key", "id": "native-editor", "actions": [
                {"type": "keyDown", "value": "X"}, {"type": "keyUp", "value": "X"},
            ]}],
        }))

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
