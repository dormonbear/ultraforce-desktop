"""Temporary per-app WebView2 policy for elevated hosted CI. / 为提权托管 CI 临时配置按应用限定的 WebView2 策略。"""
from contextlib import contextmanager
import os


@contextmanager
def webview_policy(application_name, overrides):
    if os.name != "nt" or os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise RuntimeError("WebView2 policy requires hosted Windows CI / WebView2 策略仅限托管 Windows CI")
    import winreg

    saved = []
    access = winreg.KEY_SET_VALUE | winreg.KEY_QUERY_VALUE | winreg.KEY_WOW64_64KEY
    base = r"SOFTWARE\Policies\Microsoft\Edge\WebView2"
    try:
        for setting, value in overrides.items():
            path = base + "\\" + setting
            with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, path, 0, access) as key:
                try:
                    previous = winreg.QueryValueEx(key, application_name)
                except FileNotFoundError:
                    previous = None
                saved.append((path, previous))
                winreg.SetValueEx(key, application_name, 0, winreg.REG_SZ, value)
        yield
    finally:
        # Restore only our app's values, including after partial setup failure. / 即使部分配置失败，也仅恢复本应用对应的值。
        for path, previous in reversed(saved):
            with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, path, 0, access) as key:
                if previous is None:
                    try:
                        winreg.DeleteValue(key, application_name)
                    except FileNotFoundError:
                        pass
                else:
                    value, kind = previous
                    winreg.SetValueEx(key, application_name, 0, kind, value)
