import json
from pathlib import Path
import re
import unittest


class PnpmVersionTests(unittest.TestCase):
    def test_workspace_pins_fixed_compatible_pnpm(self):
        root = Path(__file__).resolve().parent.parent
        manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
        match = re.fullmatch(r"pnpm@(\d+)\.(\d+)\.(\d+)", manifest["packageManager"])
        self.assertIsNotNone(match, "Pin an exact pnpm version / 固定精确的 pnpm 版本")
        version = tuple(map(int, match.groups()))
        self.assertGreaterEqual(
            version,
            (10, 34, 9),
            "Use the qualified pnpm 10.x baseline / 使用已验收的 pnpm 10.x 基线",
        )
        self.assertLess(
            version, (11, 0, 0), "Keep the existing compatible major / 保持现有兼容的主版本"
        )


if __name__ == "__main__":
    unittest.main()
