"""Exercise staged publication with a synthetic GitHub client. / 使用合成 GitHub 客户端测试分阶段发布。"""

import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import build_updater_manifest_test as fixtures
from stage_release import stage_release


class FakeGitHub:
    def __init__(self, metadata, source):
        self.metadata = copy.deepcopy(metadata)
        self.source = source
        self.calls = []
        self.latest = None
        self.fail_after_upload = False
        self.fail_after_publish = False
        self.fail_download = False
        self.mutate_before_upload = False
        self.mutate_after_upload = False
        self.mutate_after_publish = False
        self.change_draft_identity = False
        self.change_target_after_upload = False
        self.metadata_reads = 0
        self.release_id = "42\n"

    def __call__(self, *args):
        self.calls.append(args)
        if args[:2] == ("release", "view"):
            return self.release_id
        if args[0] == "api":
            self.metadata_reads += 1
            if self.mutate_before_upload and self.metadata_reads == 2:
                self.metadata["assets"].pop()
            if self.change_draft_identity and self.metadata_reads == 2:
                self.metadata["html_url"] = self.metadata["html_url"].replace("0123456789abcdef0123", "fedcba9876543210fedc")
                for asset in self.metadata["assets"]:
                    asset["browser_download_url"] = asset["browser_download_url"].replace("0123456789abcdef0123", "fedcba9876543210fedc")
            if self.mutate_after_upload and self.metadata_reads == 3:
                self.metadata["assets"][0]["digest"] = "sha256:" + "b" * 64
            if self.change_target_after_upload and self.metadata_reads == 3:
                self.metadata["target_commitish"] = "b" * 40
            if self.mutate_after_publish and self.metadata_reads == 4:
                self.metadata["assets"][0]["digest"] = "sha256:" + "b" * 64
            return json.dumps(self.metadata)
        if args[:2] == ("release", "download"):
            if self.fail_download:
                raise subprocess.CalledProcessError(1, ["gh", *args])
            directory = Path(args[args.index("--dir") + 1])
            pattern = args[args.index("--pattern") + 1]
            if pattern == "*.sig":
                for asset in self.metadata["assets"]:
                    if asset["name"].endswith(".sig"):
                        shutil.copyfile(self.source / asset["name"], directory / asset["name"])
            elif pattern == "latest.json":
                (directory / "latest.json").write_bytes(self.latest)
            else:
                raise AssertionError(pattern)
            return ""
        if args[:2] == ("release", "upload"):
            assert self.metadata["draft"] and "--clobber" not in args
            self.latest = Path(args[3]).read_bytes()
            release_ref = self.metadata.get("html_url", "https://github.com/dormonbear/ultraforce-desktop/releases/tag/v1.2.3").rsplit("/", 1)[-1]
            self.metadata["assets"].append({
                "name": "latest.json", "size": len(self.latest), "state": "uploaded",
                "digest": "sha256:" + hashlib.sha256(self.latest).hexdigest(),
                "browser_download_url": f"https://github.com/dormonbear/ultraforce-desktop/releases/download/{release_ref}/latest.json",
            })
            if self.fail_after_upload:
                self.fail_after_upload = False
                raise subprocess.CalledProcessError(1, ["gh", *args])
            return ""
        if args[:2] == ("release", "edit"):
            assert self.metadata["draft"] and self.latest is not None
            assert "--draft=false" in args and "--verify-tag" in args
            for asset in self.metadata["assets"]:
                asset["browser_download_url"] = asset["browser_download_url"].replace("/untagged-0123456789abcdef0123/", "/v1.2.3/")
            if "html_url" in self.metadata:
                self.metadata["html_url"] = "https://github.com/dormonbear/ultraforce-desktop/releases/tag/v1.2.3"
            self.metadata.update(draft=False, published_at="2026-10-30T00:05:00Z")
            if self.fail_after_publish:
                self.fail_after_publish = False
                raise subprocess.CalledProcessError(1, ["gh", *args])
            return ""
        raise AssertionError(args)


class StageReleaseTest(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.UpdaterManifestTest(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        metadata = self.fixture.staged_metadata()
        metadata["id"] = 42
        for index, asset in enumerate(metadata["assets"], 1):
            asset["id"] = index
            asset["updated_at"] = "2026-10-30T00:00:00Z"
        self.gh = FakeGitHub(metadata, self.fixture.root)

    def actions(self, operation):
        return [call for call in self.gh.calls if call[:2] == ("release", operation)]

    def test_complete_draft_uploads_manifest_before_publication(self):
        stage_release("v1.2.3", gh=self.gh)
        self.assertFalse(self.gh.metadata["draft"])
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)
        self.assertLess(self.gh.calls.index(self.actions("upload")[0]), self.gh.calls.index(self.actions("edit")[0]))
        self.assertEqual(json.loads(self.gh.latest)["pub_date"], "2026-10-30T00:00:00Z")

    def test_placeholder_urls_change_to_tag_urls_during_publication(self):
        metadata = self.fixture.placeholder_metadata()
        metadata["id"] = 42
        for index, asset in enumerate(metadata["assets"], 1):
            asset["id"] = index
            asset["updated_at"] = "2026-10-30T00:00:00Z"
        gh = FakeGitHub(metadata, self.fixture.root)
        stage_release("v1.2.3", gh=gh)
        self.assertFalse(gh.metadata["draft"])
        self.assertEqual(len([call for call in gh.calls if call[:2] == ("release", "upload")]), 1)
        self.assertEqual(len([call for call in gh.calls if call[:2] == ("release", "edit")]), 1)
        self.assertTrue(all(entry["url"].startswith("https://github.com/dormonbear/ultraforce-desktop/releases/download/v1.2.3/")
                            for entry in json.loads(gh.latest)["platforms"].values()))

    def test_placeholder_retries_after_lost_upload_or_publish_acknowledgement(self):
        for phase in ("upload", "publish"):
            with self.subTest(phase=phase):
                metadata = self.fixture.placeholder_metadata()
                metadata["id"] = 42
                for index, asset in enumerate(metadata["assets"], 1):
                    asset.update(id=index, updated_at="2026-10-30T00:00:00Z")
                gh = FakeGitHub(metadata, self.fixture.root)
                setattr(gh, f"fail_after_{phase}", True)
                with self.assertRaises(subprocess.CalledProcessError):
                    stage_release("v1.2.3", gh=gh)
                stage_release("v1.2.3", gh=gh)
                self.assertFalse(gh.metadata["draft"])
                self.assertEqual(len([call for call in gh.calls if call[:2] == ("release", "upload")]), 1)
                self.assertEqual(len([call for call in gh.calls if call[:2] == ("release", "edit")]), 1)

    def test_changed_draft_identity_or_duplicate_asset_id_never_publishes(self):
        for mode in ("identity", "duplicate id", "invalid id"):
            with self.subTest(mode=mode):
                metadata = self.fixture.placeholder_metadata()
                metadata["id"] = 42
                for index, asset in enumerate(metadata["assets"], 1):
                    asset.update(id=index, updated_at="2026-10-30T00:00:00Z")
                gh = FakeGitHub(metadata, self.fixture.root)
                if mode == "identity":
                    gh.change_draft_identity = True
                elif mode == "duplicate id":
                    gh.metadata["assets"][1]["id"] = gh.metadata["assets"][0]["id"]
                else:
                    gh.metadata["assets"][0]["id"] = 0
                with self.assertRaises(ValueError):
                    stage_release("v1.2.3", gh=gh)
                self.assertFalse(any(call[:2] in (("release", "upload"), ("release", "edit")) for call in gh.calls))

    def test_incomplete_or_unreadable_draft_never_publishes(self):
        for mode in ("missing asset", "failed download", "changed assets"):
            with self.subTest(mode=mode):
                gh = FakeGitHub(self.gh.metadata, self.fixture.root)
                if mode == "missing asset":
                    gh.metadata["assets"].pop()
                elif mode == "failed download":
                    gh.fail_download = True
                else:
                    gh.mutate_before_upload = True
                with self.assertRaises((KeyError, ValueError, subprocess.CalledProcessError)):
                    stage_release("v1.2.3", gh=gh)
                self.assertFalse(any(call[:2] in (("release", "upload"), ("release", "edit")) for call in gh.calls))
                self.assertTrue(gh.metadata["draft"])

    def test_retry_after_upload_acknowledgement_failure_reuses_existing_manifest(self):
        self.gh.fail_after_upload = True
        with self.assertRaises(subprocess.CalledProcessError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertTrue(self.gh.metadata["draft"])
        stage_release("v1.2.3", gh=self.gh)
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)
        self.assertFalse(self.gh.metadata["draft"])

    def test_retry_after_publication_acknowledgement_failure_never_overwrites(self):
        self.gh.fail_after_publish = True
        with self.assertRaises(subprocess.CalledProcessError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertFalse(self.gh.metadata["draft"])
        stage_release("v1.2.3", gh=self.gh)
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)

    def test_mismatched_existing_manifest_fails_closed(self):
        stage_release("v1.2.3", gh=self.gh)
        self.gh.latest = b'{"version":"wrong"}'
        latest = next(asset for asset in self.gh.metadata["assets"] if asset["name"] == "latest.json")
        latest.update(size=len(self.gh.latest), digest="sha256:" + hashlib.sha256(self.gh.latest).hexdigest())
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)

    def test_changed_asset_after_upload_prevents_publication(self):
        self.gh.mutate_after_upload = True
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertTrue(self.gh.metadata["draft"])
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(self.actions("edit"), [])

    def test_changed_asset_during_publication_is_reported(self):
        self.gh.mutate_after_publish = True
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertFalse(self.gh.metadata["draft"])
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)

    def test_invalid_existing_draft_manifest_is_never_replaced(self):
        self.gh.latest = b'{"version":"wrong"}'
        self.gh.metadata["assets"].append({
            "name": "latest.json", "size": len(self.gh.latest), "state": "uploaded",
            "digest": "sha256:" + hashlib.sha256(self.gh.latest).hexdigest(),
            "browser_download_url": "https://github.com/dormonbear/ultraforce-desktop/releases/download/v1.2.3/latest.json",
        })
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertTrue(self.gh.metadata["draft"])
        self.assertEqual(self.actions("upload"), [])
        self.assertEqual(self.actions("edit"), [])

    def test_invalid_tag_never_calls_github(self):
        with self.assertRaises(ValueError):
            stage_release("v1.2.3-rc.1", gh=self.gh)
        self.assertEqual(self.gh.calls, [])

    def test_wrong_release_identity_cannot_modify_any_release(self):
        for mode in ("invalid id", "different id", "different tag"):
            with self.subTest(mode=mode):
                gh = FakeGitHub(self.gh.metadata, self.fixture.root)
                if mode == "invalid id":
                    gh.release_id = "not-a-release-id"
                elif mode == "different id":
                    gh.metadata["id"] = 43
                else:
                    gh.metadata["tag_name"] = "v1.2.4"
                with self.assertRaises(ValueError):
                    stage_release("v1.2.3", gh=gh)
                self.assertFalse(any(call[:2] in (("release", "upload"), ("release", "edit")) for call in gh.calls))

    def test_recovery_release_id_must_match_before_mutation(self):
        with self.assertRaisesRegex(ValueError, "Release identity"):
            stage_release("v1.2.3", gh=self.gh, expected_release_id=43)
        self.assertFalse(any(call[:2] in (("release", "upload"), ("release", "edit")) for call in self.gh.calls))

    def test_recovery_release_target_must_remain_the_verified_tag_commit(self):
        self.gh.metadata["target_commitish"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "Release identity"):
            stage_release("v1.2.3", gh=self.gh, expected_release_id=42, expected_tag_sha="a" * 40)
        self.assertFalse(any(call[:2] in (("release", "upload"), ("release", "edit")) for call in self.gh.calls))

    def test_recovery_target_is_rechecked_after_upload_and_before_publication(self):
        self.gh.metadata["target_commitish"] = "a" * 40
        self.gh.change_target_after_upload = True
        with self.assertRaisesRegex(ValueError, "Release identity"):
            stage_release("v1.2.3", gh=self.gh, expected_release_id=42, expected_tag_sha="a" * 40)
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(self.actions("edit"), [])
        self.assertTrue(self.gh.metadata["draft"])

    def test_recovery_can_publish_when_release_identity_remains_stable(self):
        self.gh.metadata["target_commitish"] = "a" * 40
        stage_release("v1.2.3", gh=self.gh, expected_release_id=42, expected_tag_sha="a" * 40)
        self.assertFalse(self.gh.metadata["draft"])

    def test_missing_published_manifest_is_not_recreated(self):
        stage_release("v1.2.3", gh=self.gh)
        self.gh.metadata["assets"] = [asset for asset in self.gh.metadata["assets"] if asset["name"] != "latest.json"]
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertEqual(len(self.actions("upload")), 1)
        self.assertEqual(len(self.actions("edit")), 1)

    def test_tampered_signature_prevents_any_publication(self):
        signature = self.fixture.root / "Ultraforce_aarch64.app.tar.gz.sig"
        signature.write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            stage_release("v1.2.3", gh=self.gh)
        self.assertTrue(self.gh.metadata["draft"])
        self.assertEqual(self.actions("upload"), [])
        self.assertEqual(self.actions("edit"), [])


if __name__ == "__main__":
    unittest.main()
