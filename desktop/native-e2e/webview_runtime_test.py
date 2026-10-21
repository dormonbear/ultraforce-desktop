"""Installed browser lookup regressions. / 已安装浏览器查找回归。"""
from pathlib import Path
import tempfile
import unittest

from webview_runtime import runtime_folder


class RuntimeFolderTest(unittest.TestCase):
    def test_discovers_original_user_or_system_runtime_before_isolation(self):
        with tempfile.TemporaryDirectory(prefix="uf-runtime-") as directory:
            root = Path(directory)
            for variable in ["LOCALAPPDATA", "ProgramFiles(x86)", "ProgramFiles"]:
                with self.subTest(variable=variable):
                    base = root / variable
                    folder = base / "Microsoft/EdgeWebView/Application/155.0.4283.62"
                    folder.mkdir(parents=True)
                    (folder / "msedgewebview2.exe").touch()
                    self.assertEqual(runtime_folder({variable: str(base)}, "155.0.4283.62"), folder)
                    with self.assertRaises(FileNotFoundError):
                        runtime_folder({variable: str(base)}, "154.0.0.1")

    def test_missing_or_invalid_runtime_fails_explicitly(self):
        with self.assertRaises(FileNotFoundError):
            runtime_folder({}, "155.0.4283.62")
        with self.assertRaises(ValueError):
            runtime_folder({}, "../unrelated")
