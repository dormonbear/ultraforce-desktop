"""Native browser readiness and owned process cleanup. / 原生浏览器就绪及专属进程清理。"""
import http.client
import json
import subprocess
import time
from urllib.parse import urlparse


def wait_for_debugging(process, port, timeout=60):
    deadline = time.monotonic() + timeout
    observation = "no response / 无响应"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Native app exited before WebView2 / 原生应用在 WebView2 就绪前退出: {process.returncode}")
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
        try:
            connection.request("GET", "/json/version")
            response = connection.getresponse()
            payload = json.loads(response.read())
            observation = f"HTTP {response.status}, JSON {type(payload).__name__}"
            if response.status == 200 and isinstance(payload, dict):
                websocket = urlparse(payload.get("webSocketDebuggerUrl", ""))
                observation += f", websocket {websocket.scheme}://{websocket.hostname}:{websocket.port}"
                if websocket.scheme == "ws" and websocket.hostname in ["127.0.0.1", "localhost"] and websocket.port == port:
                    return
        except (OSError, ValueError, http.client.HTTPException) as error:
            observation = type(error).__name__
        finally:
            connection.close()
        time.sleep(0.1)
    raise TimeoutError(f"Native WebView2 debugging endpoint not ready / 原生 WebView2 调试端点未就绪: {observation}")


def stop_process_tree(process):
    if process is None:
        return
    if process.poll() is None:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, check=False)
    process.wait(timeout=15)
