"""Small W3C client for the local native driver. / 用于本地原生驱动的小型 W3C 客户端。"""
import base64
import http.client
import json
from pathlib import Path
import time


class WebDriver:
    def __init__(self, debugger_address):
        self.session = None
        result = self.request("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "webview2", "ms:edgeChromium": True,
            "ms:edgeOptions": {"debuggerAddress": debugger_address},
        }}})
        self.session = result["sessionId"]
        self.request("POST", self.endpoint("timeouts"), {"script": 120000, "implicit": 0})

    def endpoint(self, suffix):
        return f"/session/{self.session}/{suffix}"

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", 4444, timeout=130)
        try:
            connection.request(method, path, None if payload is None else json.dumps(payload), {"Content-Type": "application/json"})
            response = connection.getresponse()
            data = json.loads(response.read())
            value = data.get("value")
            if response.status >= 400 or isinstance(value, dict) and value.get("error"):
                raise RuntimeError(f"Native WebDriver error / 原生 WebDriver 错误: {data}")
            return value
        finally:
            connection.close()

    def execute(self, script, args=None):
        return self.request("POST", self.endpoint("execute/sync"), {"script": script, "args": args or []})

    def invoke(self, command, arguments):
        # Invoke real registered Rust commands; never replace the IPC implementation. / 调用真实注册的 Rust 命令，绝不替换 IPC 实现。
        result = self.request("POST", self.endpoint("execute/async"), {
            "script": """
                const [command, args, done] = arguments;
                window.__TAURI_INTERNALS__.invoke(command, args).then(
                    value => done({ok: true, value}),
                    error => done({ok: false, error})
                );
            """,
            "args": [command, arguments],
        })
        if not result["ok"]:
            raise RuntimeError(f"Native IPC failed / 原生 IPC 失败: {command}: {result.get('error')}")
        return result.get("value")

    def wait_script(self, script, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.execute(script):
                return
            time.sleep(0.1)
        raise TimeoutError("Native UI wait expired / 原生界面等待超时: " + script)

    def screenshot(self, path):
        encoded = self.request("GET", self.endpoint("screenshot"))
        Path(path).write_bytes(base64.b64decode(encoded, validate=True))

    def click(self, using, value):
        element = self.request("POST", self.endpoint("element"), {"using": using, "value": value})
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.endpoint(f"element/{identifier}/click"), {})

    def editor_keys(self, text):
        script = """return [...document.querySelectorAll('.monaco-editor textarea.inputarea')].find(
            e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
        )"""
        self.wait_script(script)
        element = self.execute(script)
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        self.request("POST", self.endpoint(f"element/{identifier}/value"), {"text": text})

