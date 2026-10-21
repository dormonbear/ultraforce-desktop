"""Regress independent Rust coverage floors. / 回归独立的 Rust 覆盖率门槛。"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_rust_coverage import check_report


def report(lines=90, functions=85, desktop=45):
    return {"type": "llvm.coverage.json.export", "version": "3.1.0", "data": [{
        "totals": {"lines": {"count": 1000, "covered": int(lines * 10)},
                   "functions": {"count": 100, "covered": functions}},
        "files": [
            {"filename": "desktop/src-tauri/src/indexing.rs",
             "summary": {"lines": {"count": 100, "covered": desktop}}},
            {"filename": "crates/features/src/index.rs",
             "summary": {"lines": {"count": 900, "covered": int(lines * 10) - desktop}}},
        ],
    }]}


class RustCoverageTest(unittest.TestCase):
    def test_accepts_boundary_values_and_current_report_shape(self):
        values = check_report(report(lines=85, functions=83, desktop=44), Path.cwd())
        self.assertEqual(values, {"lines": 85, "functions": 83, "desktop_lines": 44})

    def test_high_library_coverage_cannot_hide_a_desktop_regression(self):
        with self.assertRaisesRegex(ValueError, "desktop_lines"):
            check_report(report(lines=90, desktop=43), Path.cwd())

    def test_desktop_floor_weights_lines_instead_of_averaging_file_percentages(self):
        data = report()
        data["data"][0]["totals"]["lines"] = {"count": 10000, "covered": 8901}
        data["data"][0]["files"] = [
            {"filename": "desktop/src-tauri/src/large.rs",
             "summary": {"lines": {"count": 1000, "covered": 300}}},
            {"filename": "desktop/src-tauri/src/small.rs",
             "summary": {"lines": {"count": 1, "covered": 1}}},
            {"filename": "crates/features/src/lib.rs",
             "summary": {"lines": {"count": 8999, "covered": 8600}}},
        ]
        with self.assertRaisesRegex(ValueError, "desktop_lines"):
            check_report(data, Path.cwd())

    def test_line_and_function_floors_are_independent(self):
        for metric, value in (("lines", 84.9), ("functions", 82)):
            with self.subTest(metric=metric):
                with self.assertRaisesRegex(ValueError, metric):
                    check_report(report(**{metric: value}), Path.cwd())

    def test_absolute_and_relative_windows_separators_match_desktop_scope(self):
        for name in (str(Path.cwd() / "desktop/src-tauri/src/indexing.rs"),
                     "desktop\\src-tauri\\src\\indexing.rs"):
            data = report()
            data["data"][0]["files"][0]["filename"] = name
            self.assertEqual(check_report(data, Path.cwd())["desktop_lines"], 45)

    def test_missing_desktop_data_cannot_pass_with_high_workspace_totals(self):
        data = report()
        data["data"][0]["files"] = data["data"][0]["files"][1:]
        with self.assertRaisesRegex(ValueError, "Desktop"):
            check_report(data, Path.cwd())

    def test_invalid_or_empty_counts_fail_closed(self):
        for counts in ({"count": 0, "covered": 0}, {"count": 100, "covered": 101},
                       {"count": True, "covered": 1}, {"count": 100, "covered": -1}):
            with self.subTest(counts=counts):
                data = report()
                data["data"][0]["totals"]["lines"] = counts
                with self.assertRaises(ValueError):
                    check_report(data, Path.cwd())

    def test_incomplete_exports_are_rejected(self):
        for data in ({}, {"type": "llvm.coverage.json.export", "data": []}):
            with self.assertRaises(ValueError):
                check_report(data, Path.cwd())

    def test_ci_command_returns_failure_for_an_undercovered_desktop(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.json"
            for desktop, expected in ((45, 0), (43, 1)):
                summary.write_text(json.dumps(report(desktop=desktop)), encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("check_rust_coverage.py")),
                     "--summary-file", str(summary)], capture_output=True, text=True, encoding="utf-8",
                )
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                self.assertIn("Rust 覆盖率", result.stdout if expected == 0 else result.stderr)
