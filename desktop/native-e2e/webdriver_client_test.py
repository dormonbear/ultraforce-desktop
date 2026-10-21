"""Attach to the existing native browser. / 连接已启动的原生浏览器。"""
import unittest
from unittest.mock import patch

from webdriver_client import WebDriver


class NativeAttachTest(unittest.TestCase):
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
