"""Small W3C client for the local native driver. / 用于本地原生驱动的小型 W3C 客户端。"""
import base64
import http.client
import json
from pathlib import Path
import time


def key_actions(text):
    actions = []
    modifiers = []
    for key in text:
        if key == "\ue000":
            actions.extend({"type": "keyUp", "value": modifier} for modifier in reversed(modifiers))
            modifiers.clear()
        elif key in ["\ue008", "\ue009", "\ue00a", "\ue03d"]:
            if key not in modifiers:
                modifiers.append(key)
                actions.append({"type": "keyDown", "value": key})
        else:
            actions.extend([{"type": "keyDown", "value": key}, {"type": "keyUp", "value": key}])
    actions.extend({"type": "keyUp", "value": modifier} for modifier in reversed(modifiers))
    return actions


class WebDriver:
    EDITOR_STATE = """const editor = [...document.querySelectorAll('.monaco-editor')]
        .find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
        const context = editor?.querySelector('.native-edit-context')?.editContext;
        const textarea = editor?.querySelector('textarea.inputarea');
        const input = context || textarea;
        return input ? {text: context ? context.text : textarea.value,
            start: input.selectionStart, end: input.selectionEnd} : null;"""

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

    def wait_script(self, script, timeout=30, args=None):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.execute(script, args):
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

    def open_editor(self, empty_label):
        # A fresh workspace has no editor until the user creates a tab. / 新工作区需由用户创建标签页后才有编辑器。
        self.wait_script("""return [...document.querySelectorAll('.monaco-editor')]
            .some(e => e.getClientRects().length) || [...document.querySelectorAll('button')]
            .some(e => e.getClientRects().length && e.textContent.trim() === arguments[0])""", args=[empty_label])
        buttons = self.request("POST", self.endpoint("elements"), {
            "using": "xpath", "value": f"//button[normalize-space()='{empty_label}']",
        })
        if buttons:
            identifier = buttons[0]["element-6066-11e4-a52e-4f735466cecf"]
            self.request("POST", self.endpoint(f"element/{identifier}/click"), {})

    def editor_state(self):
        return self.execute(self.EDITOR_STATE)

    def wait_editor_state(self, text=None, offset=None):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = self.editor_state()
            if state and (text is None or state["text"] == text) and (offset is None or state["start"] == offset == state["end"]):
                return
            time.sleep(0.1)
        raise TimeoutError(f"Native editor state / 原生编辑器状态: {state}")

    def editor_keys(self, text, focus=True):
        # Native key actions support both EditContext and textarea editors. / 原生键盘动作兼容 EditContext 和 textarea 编辑器。
        script = """return [...document.querySelectorAll('.monaco-editor')].find(
            e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
        )"""
        self.wait_script(script)
        element = self.execute(script)
        identifier = element["element-6066-11e4-a52e-4f735466cecf"]
        if focus:
            self.request("POST", self.endpoint(f"element/{identifier}/click"), {})
        self.request("POST", self.endpoint("actions"), {"actions": [{
            "type": "key", "id": "native-editor", "actions": key_actions(text),
        }]})

