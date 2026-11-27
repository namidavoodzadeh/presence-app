#!/usr/bin/env python3
"""Tests for tools/review_split.py. Run: python3 -I tools/test_review_split.py (tools/selftest.sh runs it)."""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from review_split import changed_files, continued_file, split_diff


def file_diff(name, hunks, lines_per_hunk=20, width=60):
    out = [f"diff --git a/{name} b/{name}\n", "index 1111111..2222222 100644\n", f"--- a/{name}\n", f"+++ b/{name}\n"]
    for h in range(hunks):
        out.append(f"@@ -{h * 100 + 1},{lines_per_hunk} +{h * 100 + 1},{lines_per_hunk} @@ def f{h}():\n")
        out += [f"+{name} hunk {h} line {i} ".ljust(width, "x") + "\n" for i in range(lines_per_hunk)]
    return "".join(out)


class SplitDiff(unittest.TestCase):
    def test_under_limit_is_one_part(self):
        diff = file_diff("a.py", 2) + file_diff("b.py", 1)
        self.assertEqual(split_diff(diff, len(diff)), [diff])
        self.assertEqual(split_diff(diff, 180_000), [diff])

    def test_over_limit_splits_at_file_boundaries_and_rejoins(self):
        files = [file_diff(f"dir/f{i}.py", 3) for i in range(10)]
        diff = "".join(files)
        limit = len(files[0]) * 3 + 10
        parts = split_diff(diff, limit)
        self.assertGreater(len(parts), 1)
        self.assertEqual("".join(parts), diff)
        for p in parts:
            self.assertLessEqual(len(p), limit)
            self.assertTrue(p.startswith("diff --git "))
            self.assertIsNone(continued_file(parts, parts.index(p)))

    def test_file_over_limit_splits_at_hunk_boundaries(self):
        big = file_diff("big.swift", 12)
        diff = file_diff("small.py", 1) + big + file_diff("tail.py", 1)
        limit = len(big) // 4
        parts = split_diff(diff, limit)
        self.assertGreater(len(parts), 4)
        self.assertEqual("".join(parts), diff)
        for n, p in enumerate(parts):
            self.assertLessEqual(len(p), limit)
            self.assertTrue(p.startswith("diff --git ") or p.startswith("@@ "), p[:40])
            if p.startswith("@@ "):
                self.assertEqual(continued_file(parts, n), "big.swift")

    def test_hunk_and_line_over_limit_still_rejoin(self):
        diff = file_diff("huge.ts", 1, lines_per_hunk=200) + "+" + "y" * 5000 + "\n"
        parts = split_diff(diff, 1000)
        self.assertEqual("".join(parts), diff)
        self.assertTrue(all(len(p) <= 1000 for p in parts))

    def test_changed_files_lists_every_file_in_order(self):
        diff = "".join(file_diff(n, 1) for n in ["x/a.py", "b c.md", "z.yml"])
        self.assertEqual(changed_files(diff), ["x/a.py", "b c.md", "z.yml"])

    def test_large_realistic_diff(self):
        diff = "".join(file_diff(f"app/F{i}.swift", 40) for i in range(60))
        self.assertGreater(len(diff), 180_000)
        parts = split_diff(diff, 180_000)
        self.assertGreater(len(parts), 1)
        self.assertEqual("".join(parts), diff)
        self.assertTrue(all(len(p) <= 180_000 for p in parts))


if __name__ == "__main__":
    unittest.main()
