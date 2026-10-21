"""Release metadata regressions. / 发布元信息回归测试。"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_release_versions import check_versions


class ReleaseVersionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ultraforce-release-versions-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write(".release-please-manifest.json", json.dumps({".": "1.2.3"}))
        for path in ("desktop/package.json", "npm/package.json", "desktop/src-tauri/tauri.conf.json"):
            self.write(path, json.dumps({"version": "1.2.3"}))
        self.write("desktop/src-tauri/Cargo.toml", '[package]\nname = "ultraforce-desktop"\nversion = "1.2.3"\n')
        self.lock = (
            'version = 4\n\n[[package]]\nname = "unrelated"\nversion = "9.8.7"\n\n'
            '[[package]]\nname = "ultraforce-desktop"\nversion = "1.2.3"\n'
        )
        self.write("Cargo.lock", self.lock)

    def write(self, path: str, content: str):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def test_aligned_versions_ignore_unrelated_packages(self):
        self.assertEqual(check_versions(self.root), "1.2.3")

    def test_registry_package_with_same_name_is_not_the_app(self):
        self.write("Cargo.lock", self.lock + (
            '\n[[package]]\nname = "ultraforce-desktop"\nversion = "9.8.7"\n'
            'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
        ))
        self.assertEqual(check_versions(self.root), "1.2.3")

    def test_generated_release_with_stale_lock_fails(self):
        for path in ("desktop/package.json", "npm/package.json", "desktop/src-tauri/tauri.conf.json"):
            self.write(path, json.dumps({"version": "1.2.4"}))
        self.write("desktop/src-tauri/Cargo.toml", '[package]\nname = "ultraforce-desktop"\nversion = "1.2.4"\n')
        self.write(".release-please-manifest.json", json.dumps({".": "1.2.4"}))
        with self.assertRaisesRegex(ValueError, "Cargo.lock"):
            check_versions(self.root)
        self.write("Cargo.lock", self.lock.replace('"1.2.3"', '"1.2.4"'))
        self.assertEqual(check_versions(self.root), "1.2.4")

    def test_each_json_version_must_match(self):
        for path in ("desktop/package.json", "npm/package.json", "desktop/src-tauri/tauri.conf.json"):
            with self.subTest(path=path):
                self.write(path, json.dumps({"version": "1.2.2"}))
                with self.assertRaisesRegex(ValueError, path):
                    check_versions(self.root)
                self.write(path, json.dumps({"version": "1.2.3"}))

    def test_missing_or_duplicate_local_entry_fails(self):
        for lock in (self.lock.replace('name = "ultraforce-desktop"', 'name = "other"'),
                     self.lock + '\n[[package]]\nname = "ultraforce-desktop"\nversion = "1.2.3"\n'):
            with self.subTest(lock=lock):
                self.write("Cargo.lock", lock)
                with self.assertRaisesRegex(ValueError, "one local desktop"):
                    check_versions(self.root)

    def test_cli_fails_closed_on_malformed_metadata(self):
        self.write("Cargo.lock", "not valid TOML")
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("check_release_versions.py")), "--root", str(self.root)],
            capture_output=True, text=True, encoding="utf-8", check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("Release version check failed", result.stderr)

    def test_cli_bilingual_output_survives_windows_legacy_encoding(self):
        # Reproduce Windows redirected-output encoding on every runner. / 在所有运行器复现 Windows 重定向输出编码。
        command = [sys.executable, str(Path(__file__).with_name("check_release_versions.py")), "--root", str(self.root)]
        environment = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        success = subprocess.run(command, env=environment, capture_output=True, check=False)
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertIn("发布版本一致", success.stdout.decode("utf-8"))
        self.write("Cargo.lock", "not valid TOML")
        failure = subprocess.run(command, env=environment, capture_output=True, check=False)
        self.assertEqual(failure.returncode, 1)
        self.assertIn("发布版本检查失败", failure.stderr.decode("utf-8"))
        self.assertNotIn(b"Traceback", failure.stderr)


if __name__ == "__main__":
    unittest.main()
