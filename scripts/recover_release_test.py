"""Resume incomplete releases without changing unrelated versions. / 恢复未完成发布而不修改其他版本。"""

import copy
import json
import subprocess
import unittest

from recover_release import npm_has_version, recover_release


SHA = "a" * 40
RELEASE = {"id": 42, "tag_name": "v1.2.3", "draft": True, "prerelease": False, "target_commitish": SHA}


class FakeServices:
    def __init__(self, release=RELEASE):
        self.pages = [[copy.deepcopy(release)]] if release is not None else [[]]
        self.calls = []
        self.registry_present = False
        self.sha = SHA
        self.sha_reads = 0
        self.changed_sha_on_read = None
        self.ancestor = True
        self.npm_source_unchanged = True
        self.stage_error = None
        self.tag_version = "1.2.3"

    def gh(self, *args):
        self.calls.append(("gh", *args))
        return json.dumps(self.pages)

    def git(self, *args):
        self.calls.append(("git", *args))
        if args[0] == "rev-parse":
            self.sha_reads += 1
            if self.sha_reads == self.changed_sha_on_read:
                return "b" * 40 + "\n"
            return self.sha + "\n"
        if args[0] == "show":
            name = args[1].split(":", 1)[1]
            version = self.tag_version
            if name == ".release-please-manifest.json": return json.dumps({".": version})
            if name.endswith("Cargo.toml"): return f'[package]\nname="ultraforce-desktop"\nversion="{version}"\n'
            if name == "Cargo.lock": return f'[[package]]\nname="ultraforce-desktop"\nversion="{version}"\n'
            return json.dumps({"version": version})
        if args[0] == "merge-base" and not self.ancestor:
            raise subprocess.CalledProcessError(1, ["git", *args])
        if args[0] == "diff" and not self.npm_source_unchanged:
            raise subprocess.CalledProcessError(1, ["git", *args])
        return ""

    def npm(self, version):
        self.calls.append(("npm", version))
        return self.registry_present

    def stage(self, tag, *, gh, expected_release_id, expected_tag_sha):
        self.calls.append(("stage", tag, expected_release_id, expected_tag_sha))
        if self.stage_error:
            raise self.stage_error

    def run(self, version="1.2.3"):
        return recover_release(version, gh=self.gh, git=self.git, npm=self.npm, stage=self.stage)


class RecoverReleaseTest(unittest.TestCase):
    def test_matching_draft_is_staged_before_requesting_tagged_npm_publication(self):
        services = FakeServices()
        self.assertEqual(services.run(), {"tag": "v1.2.3", "sha": SHA})
        self.assertEqual([c[0] for c in services.calls].count("npm"), 2)
        self.assertLess(services.calls.index(("git", "merge-base", "--is-ancestor", SHA, "HEAD")), services.calls.index(("stage", "v1.2.3", 42, SHA)))
        self.assertIn(("git", "merge-base", "--is-ancestor", SHA, "HEAD"), services.calls)

    def test_published_release_missing_npm_is_revalidated_before_retry(self):
        services = FakeServices({**RELEASE, "draft": False})
        self.assertEqual(services.run(), {"tag": "v1.2.3", "sha": SHA})
        self.assertEqual([c[0] for c in services.calls].count("stage"), 1)

    def test_missing_release_or_existing_published_npm_is_a_noop(self):
        for services in (FakeServices(None), FakeServices({**RELEASE, "draft": False})):
            with self.subTest(pages=services.pages):
                services.registry_present = True
                self.assertIsNone(services.run())
                self.assertFalse(any(c[0] in ("git", "stage") for c in services.calls))

    def test_wrong_release_identity_or_unreachable_tag_never_stages(self):
        for mode in ("duplicate", "prerelease", "target", "tag sha", "ancestor", "tag version"):
            with self.subTest(mode=mode):
                services = FakeServices()
                if mode == "duplicate": services.pages[0].append(copy.deepcopy(RELEASE))
                elif mode == "prerelease": services.pages[0][0]["prerelease"] = True
                elif mode == "target": services.pages[0][0]["target_commitish"] = "b" * 40
                elif mode == "tag sha": services.sha = "not-a-sha"
                elif mode == "ancestor": services.ancestor = False
                else: services.tag_version = "1.2.2"
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    services.run()
                self.assertFalse(any(c[0] == "stage" for c in services.calls))

    def test_stage_or_registry_failure_never_requests_npm(self):
        services = FakeServices()
        services.stage_error = ValueError("Synthetic incomplete draft / 合成不完整草稿")
        with self.assertRaises(ValueError): services.run()
        self.assertEqual([c[0] for c in services.calls].count("npm"), 1)
        for draft in (True, False):
            services = FakeServices({**RELEASE, "draft": draft})
            def failed_registry(_version): raise RuntimeError("Synthetic registry failure / 合成注册表失败")
            services.npm = failed_registry
            with self.assertRaises(RuntimeError): services.run()
            self.assertFalse(any(c[0] == "stage" for c in services.calls))

    def test_changed_tag_is_rejected_before_or_after_staging(self):
        for changed_at in (2, 3):
            with self.subTest(changed_at=changed_at):
                services = FakeServices()
                services.changed_sha_on_read = changed_at
                with self.assertRaisesRegex(ValueError, "tag changed"):
                    services.run()
                self.assertEqual(any(c[0] == "stage" for c in services.calls), changed_at == 3)
                self.assertEqual([c[0] for c in services.calls].count("npm"), 1)

    def test_changed_npm_source_is_rejected_before_staging(self):
        services = FakeServices()
        services.npm_source_unchanged = False
        with self.assertRaises(subprocess.CalledProcessError):
            services.run()
        self.assertFalse(any(c[0] == "stage" for c in services.calls))
        self.assertIn(("git", "diff", "--quiet", SHA, "HEAD", "--", "npm"), services.calls)

    def test_registry_only_treats_explicit_404_as_missing(self):
        def runner(code, output):
            return lambda *_args, **_kwargs: subprocess.CompletedProcess([], code, output, "")
        self.assertTrue(npm_has_version("1.2.3", runner=runner(0, '"1.2.3"')))
        self.assertFalse(npm_has_version("1.2.3", runner=runner(1, '{"error":{"code":"E404"}}')))
        for code, output in [(1, '{"error":{"code":"E500"}}'), (1, "network error"), (0, '"1.2.2"')]:
            with self.subTest(code=code, output=output), self.assertRaises(ValueError):
                npm_has_version("1.2.3", runner=runner(code, output))

    def test_npm_published_during_staging_does_not_request_duplicate_publication(self):
        services = FakeServices()
        responses = iter((False, True))
        services.npm = lambda _version: next(responses)
        self.assertIsNone(services.run())
        self.assertIn(("stage", "v1.2.3", 42, SHA), services.calls)

    def test_registry_failure_after_staging_fails_without_requesting_npm(self):
        services = FakeServices()
        responses = iter((False, RuntimeError("Synthetic registry failure / 合成注册表失败")))
        def npm(_version):
            response = next(responses)
            if isinstance(response, Exception):
                raise response
            return response
        services.npm = npm
        with self.assertRaises(RuntimeError):
            services.run()
        self.assertIn(("stage", "v1.2.3", 42, SHA), services.calls)


if __name__ == "__main__":
    unittest.main()
