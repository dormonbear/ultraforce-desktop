"""Native Tauri, real IPC and SQLite acceptance. / 原生 Tauri、真实 IPC 及 SQLite 验收。"""
import argparse
from contextlib import closing, contextmanager
import ctypes
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

from sf_fixture import ORG
from webdriver_client import WebDriver
from webview_runtime import matching_runtime
from startup_diagnostics import capture_desktop
from native_process import stop_process_tree, wait_for_debugging
from webview_policy import webview_policy


def fixture(root, runtime=None):
    root.mkdir(parents=True)
    (root / "synthetic-only").touch()
    (root / "mode").write_text("normal", encoding="utf-8")
    bin_dir = root / "bin"
    bin_dir.mkdir()
    script = bin_dir / "sf_fixture.py"
    shutil.copyfile(Path(__file__).with_name("sf_fixture.py"), script)
    subprocess.run([
        "rustc", str(Path(__file__).with_name("sf_shim.rs")), "-o",
        str(bin_dir / ("sf.exe" if os.name == "nt" else "sf")),
    ], check=True)
    inherited = {key.upper() if os.name == "nt" else key: value for key, value in os.environ.items()}
    environment = {
        **inherited, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        "APPDATA": str(root / "roaming"), "LOCALAPPDATA": str(root / "local"),
        "UF_NATIVE_FIXTURE": str(root),
        "UF_NATIVE_PYTHON": sys.executable,
        # Prove the app overrides inherited opt-ins for every CLI process. / 验证应用为每个 CLI 进程覆盖继承的收集启用值。
        **{flag: "false" for flag in [
            "SF_DISABLE_TELEMETRY", "SFDX_DISABLE_TELEMETRY", "SF_DISABLE_LOG_FILE", "SFDX_DISABLE_LOG_FILE",
        ]},
    }
    if runtime is not None:
        environment["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"] = str(runtime)
    return environment


@contextmanager
def application(application_path, environment, artifacts, name):
    driver = None
    process = None
    app = None
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    app_environment = {
        **environment,
        "TAURI_WEBVIEW_AUTOMATION": "true",
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={port} --remote-debugging-address=127.0.0.1",
        "WEBVIEW2_USER_DATA_FOLDER": str(Path(environment["UF_NATIVE_FIXTURE"]) / f"{name}-browser"),
    }
    with (artifacts / f"{name}-driver.log").open("wb") as log, \
            (artifacts / f"{name}-stdout.log").open("wb") as stdout, \
            (artifacts / f"{name}-stderr.log").open("wb") as stderr, \
            webview_policy(application_path.name, {
                "AdditionalBrowserArguments": app_environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"],
                "UserDataFolder": app_environment["WEBVIEW2_USER_DATA_FOLDER"],
                "BrowserExecutableFolder": app_environment["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"],
            }):
        try:
            # Launch the real app, then attach to its loopback WebView2 endpoint. / 启动真实应用，再连接其回环 WebView2 端点。
            app = subprocess.Popen([str(application_path)], env=app_environment, stdout=stdout, stderr=stderr)
            wait_for_debugging(app, port)
            process = subprocess.Popen(["tauri-driver"], env=app_environment, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise RuntimeError("Native driver exited / 原生驱动已退出")
                try:
                    with socket.create_connection(("127.0.0.1", 4444), timeout=0.5):
                        break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Native driver startup / 原生驱动启动超时")
                    time.sleep(0.1)
            driver = WebDriver(f"127.0.0.1:{port}")
            driver.wait_script("return !!window.__TAURI_INTERNALS__ && !!document.querySelector('nav button[aria-label=SOQL]')")
            yield driver
        except Exception:
            (artifacts / f"{name}-startup.json").write_text(json.dumps({
                "exitCode": None if app is None else app.poll(), "debuggingPort": port,
            }), encoding="utf-8")
            if driver:
                try:
                    driver.screenshot(artifacts / f"{name}-failure.png")
                except Exception:
                    pass
            else:
                capture_desktop(artifacts / f"{name}-attach-failure.png")
            raise
        finally:
            # Both trees belong to this fixture; the proxy did not launch the app. / 两棵进程树均属于此夹具，代理未启动应用。
            try:
                stop_process_tree(process)
            finally:
                stop_process_tree(app)


def verify_completions(driver):
    query = "SELECT  FROM Synthetic__c"
    fields = driver.invoke("soql_complete", {"query": query, "offset": 7, "org": ORG})
    assert any(item["label"] == "Name" for item in fields), fields
    source = "NativeService."
    members = driver.invoke("apex_complete", {"src": source, "offset": len(source), "org": ORG})
    assert any(item["label"] == "run" for item in members), members


def verify_database(root, stdlib_error):
    files = list((root / "local" / "ultraforce").rglob("index.db"))
    assert len(files) == 1, files
    # Readers may need WAL sidecars; SQL stays read-only in this owned fixture. / 读取可能需要 WAL 辅助文件，此专属夹具中 SQL 保持只读。
    with closing(sqlite3.connect(files[0])) as database:
        database.execute("PRAGMA query_only=ON")
        assert database.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        version, error, generation = database.execute("SELECT schema_version, stdlib_error, generation FROM meta").fetchone()
        assert version == 5, version
        assert bool(error) == stdlib_error, error
        if stdlib_error:
            assert "Synthetic Tooling stdlib failure" in error, error
        for sql in [
            "SELECT 1 FROM objects WHERE name='Synthetic__c'",
            "SELECT 1 FROM fields WHERE name='Name'",
            "SELECT 1 FROM apex_types WHERE name='NativeService'",
            "SELECT 1 FROM apex_members WHERE name='run'",
            "SELECT 1 FROM objects_fts WHERE object_name='Synthetic__c'",
            "SELECT 1 FROM apex_fts WHERE type_name='NativeService'",
        ]:
            assert database.execute(sql).fetchone(), sql
        return generation


def verify_schema_ui(driver):
    driver.click("css selector", 'nav button[aria-label="Schema"]')
    driver.wait_script("return document.body.innerText.includes('Synthetic Object')")
    driver.click("xpath", "//button[.//span[normalize-space()='Synthetic__c']]")
    driver.wait_script("return document.body.innerText.includes('Native Fixture Name')")


def verify_editor_ui(driver):
    # WebDriver sends native keys through Monaco's actual completion providers. / WebDriver 向 Monaco 的真实补全提供器发送原生按键。
    driver.click("css selector", 'nav button[aria-label="SOQL"]')
    driver.editor_keys("\ue009a\ue000SELECT  FROM Synthetic__c\ue009\ue011\ue000" + "\ue014" * 7 + "\ue009\ue00d\ue000")
    driver.wait_script("return [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(e => e.getClientRects().length && e.innerText.includes('Name'))")
    driver.editor_keys("\ue00c")
    driver.click("css selector", 'nav button[aria-label="Apex"]')
    driver.editor_keys("\ue009a\ue000NativeService.\ue009\ue00d\ue000")
    driver.wait_script("return [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(e => e.getClientRects().length && e.innerText.includes('run'))")
    driver.editor_keys("\ue00c")


def run(application_path, artifacts):
    if os.name != "nt" or os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise RuntimeError("Run native acceptance on hosted Windows CI / 请在托管 Windows CI 运行原生验收")
    artifacts.mkdir(parents=True, exist_ok=True)
    elevated = bool(ctypes.windll.shell32.IsUserAnAdmin())
    (artifacts / "host-context.json").write_text(json.dumps({"elevated": elevated}), encoding="utf-8")
    print(f"Elevated Windows host / Windows 提权宿主: {elevated}")
    runtime = matching_runtime()
    (artifacts / "runtime-location.txt").write_text(str(runtime), encoding="utf-8")
    print(f"Native WebView2 runtime / 原生 WebView2 运行时: {runtime}")
    with tempfile.TemporaryDirectory(prefix="uf-native-", ignore_cleanup_errors=True) as directory:
        root = Path(directory) / "normal"
        environment = fixture(root, runtime)
        with application(application_path, environment, artifacts, "full") as driver:
            assert driver.invoke("sf_status", {})["state"] == "ok"
            driver.invoke("ensure_ready", {"org": ORG, "namespaces": "all"})
            verify_completions(driver)
            generation = verify_database(root, False)
            verify_schema_ui(driver)
            driver.screenshot(artifacts / "native-schema.png")
            verify_editor_ui(driver)
        # Reopen with acquisition unavailable: completion must reload SQLite. / 禁用采集后重新启动，补全必须从 SQLite 重载。
        (root / "mode").write_text("offline", encoding="utf-8")
        with application(application_path, environment, artifacts, "offline") as driver:
            driver.invoke("ensure_ready", {"org": ORG, "namespaces": "all"})
            verify_completions(driver)
            assert verify_database(root, False) == generation
            verify_schema_ui(driver)
            verify_editor_ui(driver)
        failed_root = Path(directory) / "stdlib-error"
        failed_environment = fixture(failed_root, runtime)
        (failed_root / "mode").write_text("stdlib-error", encoding="utf-8")
        with application(application_path, failed_environment, artifacts, "stdlib-error") as driver:
            driver.invoke("ensure_ready", {"org": ORG, "namespaces": "all"})
            verify_completions(driver)
            verify_database(failed_root, True)
            verify_schema_ui(driver)
            verify_editor_ui(driver)
        print("PASS: native UI, real IPC, SQLite reopen, completions and stdlib failure / 原生界面、真实 IPC、SQLite 重载、补全及标准库失败验证通过")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, default=Path("native-e2e-artifacts"))
    args = parser.parse_args()
    run(args.application.resolve(), args.artifacts.resolve())
