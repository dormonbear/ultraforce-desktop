"""Actual browser readiness contract. / 真实浏览器就绪契约。"""
import json
import unittest
from unittest.mock import MagicMock, patch

from native_process import wait_for_debugging


class BrowserReadinessTest(unittest.TestCase):
    def test_exited_application_fails_before_connecting(self):
        process = MagicMock()
        process.poll.return_value = 101
        process.returncode = 101
        with patch("native_process.http.client.HTTPConnection") as connect:
            with self.assertRaisesRegex(RuntimeError, "Native app exited"):
                wait_for_debugging(process, 9222)
            connect.assert_not_called()

    def test_only_matching_local_browser_websocket_counts_as_ready(self):
        process = MagicMock()
        process.poll.return_value = None
        for url, ready in [
            ("ws://127.0.0.1:9222/devtools/browser/fixture", True),
            ("", False), ("ws://external.invalid:9222/fixture", False),
            ("ws://127.0.0.1:9333/fixture", False),
        ]:
            with self.subTest(url=url):
                response = MagicMock(status=200)
                response.read.return_value = json.dumps({"webSocketDebuggerUrl": url}).encode()
                connection = MagicMock()
                connection.getresponse.return_value = response
                with patch("native_process.http.client.HTTPConnection", return_value=connection):
                    with patch("native_process.time.sleep"):
                        if ready:
                            wait_for_debugging(process, 9222, timeout=0.01)
                        else:
                            with self.assertRaises(TimeoutError):
                                wait_for_debugging(process, 9222, timeout=0.01)
