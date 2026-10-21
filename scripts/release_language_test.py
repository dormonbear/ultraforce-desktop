"""Release generator language contract. / 发布生成器语言契约。"""
import json
from pathlib import Path
import re
import unittest


class ReleaseLanguageTest(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).resolve().parents[1] / "release-please-config.json").read_text(encoding="utf-8"))

    def assert_bilingual(self, value):
        english = re.search(r"[A-Za-z]", value)
        chinese = re.search(r"[\u4e00-\u9fff]", value)
        self.assertIsNotNone(english, value)
        self.assertIsNotNone(chinese, value)
        self.assertLess(english.start(), chinese.start(), value)

    def test_generated_title_and_wrapper_are_bilingual(self):
        for key in ["pull-request-title-pattern", "pull-request-header", "pull-request-footer"]:
            with self.subTest(key=key):
                self.assert_bilingual(self.config.get(key, ""))
        pattern = self.config["pull-request-title-pattern"]
        # Duplicate placeholders break Release Please's regex and replacement contract. / 重复占位符会破坏 Release Please 的正则及替换契约。
        for placeholder in ["${scope}", "${component}", "${version}"]:
            self.assertEqual(pattern.count(placeholder), 1, placeholder)

    def test_sections_are_bilingual_without_hiding_existing_release_categories(self):
        sections = self.config.get("changelog-sections", [])
        self.assertTrue(sections)
        for section in sections:
            with self.subTest(type=section["type"]):
                self.assert_bilingual(section["section"])
        visible = {section["type"] for section in sections if not section.get("hidden", False)}
        self.assertEqual(visible, {"feat", "feature", "fix", "perf", "revert"})
