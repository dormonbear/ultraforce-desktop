"""Verify the commit hook's privacy and exit status. / 验证提交钩子的隐私约束与退出状态。"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOOK_WITH_STUB = r"""
pnpm() {
  case "$*" in
    'exec oxlint src') printf 'lint\n' >> "$FALLOW_TEST_TRACE" ;;
    'exec fallow audit')
      printf 'fallow:%s\n' "${FALLOW_TELEMETRY_DISABLED-unset}" >> "$FALLOW_TEST_TRACE"
      return "$FALLOW_TEST_EXIT"
      ;;
    *) return 13 ;;
  esac
}
export -f pnpm
exec "$BASH" .husky/pre-commit
"""


class PrecommitTest(unittest.TestCase):
    def run_hook(self, fallow_exit):
        bash = shutil.which("bash")
        if os.name == "nt":
            git = shutil.which("git")
            if git:
                git_bash = Path(git).parent.parent / "bin" / "bash.exe"
                if git_bash.is_file():
                    bash = str(git_bash)
        self.assertIsNotNone(bash, "Bash is required to run the repository hook / 运行仓库钩子需要 Bash")
        with tempfile.TemporaryDirectory(prefix="uf-hook-test-") as directory:
            trace = Path(directory) / "trace.txt"
            env = {
                **os.environ,
                "FALLOW_TELEMETRY": "on",
                "FALLOW_TELEMETRY_DEBUG": "1",
                "FALLOW_TELEMETRY_DISABLED": "0",
                "FALLOW_TEST_TRACE": trace.as_posix(),
                "FALLOW_TEST_EXIT": str(fallow_exit),
            }
            result = subprocess.run([bash, "-c", HOOK_WITH_STUB], cwd=ROOT, env=env,
                                    capture_output=True, text=True, encoding="utf-8", timeout=30)
            return result, trace.read_text(encoding="utf-8").splitlines() if trace.exists() else []

    def test_fallow_telemetry_is_disabled_even_when_the_environment_enables_it(self):
        result, calls = self.run_hook(0)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ["lint", "fallow:1"])

    def test_fallow_failure_still_fails_the_hook(self):
        result, calls = self.run_hook(7)
        self.assertEqual(result.returncode, 7, result.stdout + result.stderr)
        self.assertEqual(calls, ["lint", "fallow:1"])


if __name__ == "__main__":
    unittest.main()
