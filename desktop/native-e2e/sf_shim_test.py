"""Executable argv and exit-code contract. / 可执行程序参数及退出码契约。"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ExecutableFixtureTest(unittest.TestCase):
    def test_executable_forwards_literal_arguments_and_failure_status(self):
        with tempfile.TemporaryDirectory(prefix="uf-shim-") as directory:
            root = Path(directory)
            executable = root / ("sf.exe" if os.name == "nt" else "sf")
            subprocess.run(["rustc", str(Path(__file__).with_name("sf_shim.rs")), "-o", str(executable)], check=True)
            (root / "sf_fixture.py").write_text(
                "import json, sys\nprint(json.dumps(sys.argv[1:]))\nsys.exit(23)\n", encoding="utf-8",
            )
            arguments = ["SELECT Name FROM Synthetic__c", "a&b", '"quoted"', "中文", "%PATH%"]
            result = subprocess.run([str(executable), *arguments], env={
                **os.environ, "UF_NATIVE_PYTHON": sys.executable,
            }, capture_output=True, encoding="utf-8", check=False)
            self.assertEqual(result.returncode, 23, result.stderr)
            self.assertEqual(json.loads(result.stdout), arguments)
