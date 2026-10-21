"""Updater publication regressions. / 更新清单发布回归测试。"""

import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from build_updater_manifest import build_manifest


class UpdaterManifestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="uf-updater-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.metadata = {
            "tag_name": "v1.2.3", "draft": False, "prerelease": False,
            "published_at": "2026-10-21T00:00:00Z", "assets": [],
        }
        names = [
            "Ultraforce_aarch64.app.tar.gz", "Ultraforce_x64.app.tar.gz",
            "Ultraforce_1.2.3_amd64.AppImage", "Ultraforce_1.2.3_amd64.deb",
            "Ultraforce-1.2.3-1.x86_64.rpm", "Ultraforce_1.2.3_x64_en-US.msi",
            "Ultraforce_1.2.3_x64-setup.exe",
        ]
        self.signature = base64.b64encode(b"untrusted comment: fixture\nsignature\ntrusted comment: fixture\n").decode()
        for name in names:
            for suffix in ["", ".sig"]:
                asset_name = name + suffix
                raw = self.signature.encode() if suffix else b"synthetic payload"
                (self.root / asset_name).write_bytes(raw)
                self.metadata["assets"].append({
                    "name": asset_name, "size": len(raw),
                    "digest": "sha256:" + hashlib.sha256(raw).hexdigest(),
                    "browser_download_url": "https://github.com/dormonbear/ultraforce-desktop/releases/download/v1.2.3/" + asset_name,
                })

    def test_all_platforms_and_installer_preferences_are_preserved(self):
        manifest = build_manifest(self.metadata, self.root)
        self.assertEqual(manifest["version"], "1.2.3")
        self.assertEqual(len(manifest["platforms"]), 11)
        for key in ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]:
            self.assertIn(key, manifest["platforms"])
        self.assertTrue(manifest["platforms"]["linux-x86_64"]["url"].endswith(".AppImage"))
        self.assertTrue(manifest["platforms"]["windows-x86_64"]["url"].endswith(".msi"))
        self.assertTrue(all(entry["signature"] == self.signature for entry in manifest["platforms"].values()))
        self.assertEqual(manifest["pub_date"], self.metadata["published_at"])

    def test_missing_any_payload_or_signature_never_builds_partial_manifest(self):
        for asset in self.metadata["assets"]:
            with self.subTest(asset=asset["name"]):
                metadata = copy.deepcopy(self.metadata)
                metadata["assets"].remove(asset)
                with self.assertRaises(KeyError):
                    build_manifest(metadata, self.root)

    def test_stale_or_tampered_signature_is_rejected(self):
        signature = self.root / "Ultraforce_aarch64.app.tar.gz.sig"
        for raw in [b"", b"stale signature", base64.b64encode(b"malformed")]:
            with self.subTest(raw=raw):
                signature.write_bytes(raw)
                with self.assertRaises(ValueError):
                    build_manifest(self.metadata, self.root)

    def test_matching_digest_does_not_allow_malformed_signature(self):
        signature = self.root / "Ultraforce_aarch64.app.tar.gz.sig"
        for raw in [b"not-base64", base64.b64encode(b"not a minisign signature")]:
            with self.subTest(raw=raw):
                signature.write_bytes(raw)
                metadata = copy.deepcopy(self.metadata)
                metadata["assets"][1]["digest"] = "sha256:" + hashlib.sha256(raw).hexdigest()
                with self.assertRaises(ValueError):
                    build_manifest(metadata, self.root)

    def test_wrong_release_url_empty_payload_and_duplicate_assets_are_rejected(self):
        for property_name, value in [("browser_download_url", "https://example.invalid/payload"), ("size", 0)]:
            metadata = copy.deepcopy(self.metadata)
            metadata["assets"][0][property_name] = value
            with self.assertRaises(ValueError):
                build_manifest(metadata, self.root)
        metadata = copy.deepcopy(self.metadata)
        metadata["assets"].append(metadata["assets"][0])
        with self.assertRaises(ValueError):
            build_manifest(metadata, self.root)

    def test_nonstable_releases_are_rejected(self):
        for key, value in [("tag_name", "v1.2.3-rc.1"), ("draft", True), ("prerelease", True)]:
            metadata = {**self.metadata, key: value}
            with self.assertRaises(ValueError):
                build_manifest(metadata, self.root)

    def test_failed_cli_preserves_existing_manifest(self):
        # An incomplete matrix must never replace a good manifest. / 不完整的平台矩阵绝不能替换有效清单。
        metadata_path = self.root / "metadata.json"
        self.metadata["assets"].pop()
        metadata_path.write_text(json.dumps(self.metadata), encoding="utf-8")
        output = self.root / "latest.json"
        output.write_bytes(b"previous complete manifest")
        result = subprocess.run([
            sys.executable, str(Path(__file__).with_name("build_updater_manifest.py")),
            "--metadata", str(metadata_path), "--signatures", str(self.root), "--output", str(output),
        ], capture_output=True, encoding="utf-8", check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("更新清单被拒绝", result.stderr)
        self.assertEqual(output.read_bytes(), b"previous complete manifest")


if __name__ == "__main__":
    unittest.main()
