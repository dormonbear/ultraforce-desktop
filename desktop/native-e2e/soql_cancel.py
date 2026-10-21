"""Cancel a native preflight during credential refresh. / 在凭据刷新时取消原生预检。
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
from urllib.parse import parse_qs, urlsplit


def verify_soql_cancel(driver, root):
    queries = []
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            query = parse_qs(urlsplit(self.path).query).get("q", [""])[0]
            with lock:
                queries.append(query)
            assert query.upper().startswith("SELECT COUNT()"), "Unexpected query / 意外的查询"
            (root / "block-auth").touch()
            body = json.dumps([{"errorCode": "INVALID_SESSION_ID",
                                "message": "Synthetic expired session / 合成过期会话"}]).encode()
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    (root / "rest-url").write_text(f"http://127.0.0.1:{server.server_port}", encoding="utf-8")
    try:
        driver.click("css selector", 'nav button[aria-label="SOQL"]')
        driver.open_editor("New query")
        query = "SELECT Id FROM Synthetic__c"
        driver.editor_keys("\ue009a\ue000" + query)
        driver.wait_editor_state(text=query)
        driver.editor_keys("\ue009\ue007\ue000", focus=False)
        deadline = time.monotonic() + 10
        while not (root / "auth-entered").exists():
            assert time.monotonic() < deadline, "Refresh did not start / 刷新未启动"
            time.sleep(0.05)
        driver.wait_script("return document.body.innerText.includes('Checking size…')")
        driver.click("xpath", "//button[normalize-space()='Cancel']")
        driver.wait_script("""return ![...document.querySelectorAll('button')].some(
            e => e.getClientRects().length && e.textContent.trim() === 'Cancel')
            && !document.body.innerText.includes('Checking size…')""", timeout=5)
        with lock:
            assert len(queries) == 1, "Cancel launched another query / 取消后又启动了查询"
        assert not (root / "release-auth").exists(), "Auth completed before cancel / 认证在取消前已完成"
        assert not (root / "auth-expired").exists(), "Auth expired before cancel / 认证在取消前已超时"
        print("PASS: native UI cancels pending credential refresh without starting the query / 原生界面取消等待中的凭据刷新，且未启动实际查询")
    finally:
        # Release any fixture grandchild even if the shim was cancelled. / 即使垫片被取消，也释放夹具孙进程。
        (root / "release-auth").touch()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        for name in ("rest-url", "block-auth", "auth-entered", "auth-expired"):
            (root / name).unlink(missing_ok=True)
