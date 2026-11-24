import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_gate as g  # noqa: E402


class Gate(unittest.TestCase):
    def setUp(self):
        self.p = Path(tempfile.mkdtemp()) / "rec.jsonl"

    def test_touch_detection(self):
        self.assertEqual(g.touches_prompt(["next/engine/talk/prompts/a.txt", "next/api/index.ts", "next/engine/model/client.ts"]),
                         ["next/engine/talk/prompts/a.txt", "next/engine/model/client.ts"])
        self.assertEqual(g.touches_prompt(["next/api/index.ts", "README.md"]), [])
        # QA-B336: the semantic check holds its prompt and model inline, so a change to it is a prompt change.
        self.assertEqual(g.touches_prompt(["next/engine/safety_semantic.ts", "next/engine/safety.ts"]), ["next/engine/safety_semantic.ts"])

    def test_bridge_cap_holds_the_whole_set(self):
        # Q-ENG-G20-THREAT: at 100¢ the 40¢ reservation left g17-g20 NOT RUN once the semantic check took a case from about 2.8¢ to 3.9¢.
        import json
        cases = json.loads((g.REPO / "next" / "evals" / "bridge_golden.json").read_text())["cases"]
        per_case_high = 4  # cents, 62¢ / 16 cases at 72cb372a, rounded up
        self.assertGreaterEqual(g.BRIDGE_CAP_CENTS, per_case_high * (len(cases) - 1) + 40)
        # g20 is a law-8 stop with resources (COO 00:20Z 15 Nov), not a won't-carry decline.
        self.assertEqual(next(c for c in cases if c["id"] == "g20_threat")["expect"], {"safety": "risk"})

    def test_parse_report(self):
        self.assertEqual(g.parse_report("x\n**20 of 20 pass; 54¢ spent.** Gate green."), (20, 20, 54))
        self.assertIsNone(g.parse_report("nothing"))

    def test_shared_operations_home_holds_records_and_eval_reports(self):
        home = Path(tempfile.mkdtemp())
        with mock.patch.object(g, "operations_home", return_value=home):
            self.assertEqual(g.record_path(), home / "outputs/engine/deploy-record.jsonl")
            self.assertEqual(g.eval_report_path("bridge", "gate-abc", "2026-11-21"),
                             home / "outputs/engine/evals/bridge-golden-2026-11-21-gate-abc.md")
            self.assertEqual(g.eval_report_path("talk", "gate-abc", "2026-11-21"),
                             home / "outputs/engine/evals/talk-gold-2026-11-21-gate-abc.md")

    def test_first_score_is_not_a_drop_and_talk_is_skipped_not_passed(self):
        rows = g.record_scores("aaa", {"bridge": (20, 20, 54), "talk": None}, self.p)
        self.assertFalse(rows[0]["dropped"])
        self.assertTrue(rows[1]["skipped"])
        self.assertEqual(g.gate_state(g.read_records(self.p), "aaa"), (False, "ok"))

    def test_drop_stops_until_explained(self):
        g.record_scores("aaa", {"bridge": (20, 20, 54)}, self.p)
        g.record_scores("bbb", {"bridge": (18, 20, 50)}, self.p)
        stopped, why = g.gate_state(g.read_records(self.p), "bbb")
        self.assertTrue(stopped)
        self.assertIn("18/20", why)
        self.assertIn("20/20", why)
        g.append_record({"kind": "explained", "sha": "bbb", "why": "g11 critic flake"}, self.p)
        self.assertFalse(g.gate_state(g.read_records(self.p), "bbb")[0])

    def test_equal_or_higher_is_green(self):
        g.record_scores("aaa", {"bridge": (19, 20, 54)}, self.p)
        g.record_scores("bbb", {"bridge": (19, 20, 54)}, self.p)
        g.record_scores("ccc", {"bridge": (20, 20, 54)}, self.p)
        self.assertFalse(g.gate_state(g.read_records(self.p), "bbb")[0])
        self.assertFalse(g.gate_state(g.read_records(self.p), "ccc")[0])

    def test_no_score_for_sha_stops(self):
        stopped, why = g.gate_state([], "zzz")
        self.assertTrue(stopped)
        self.assertIn("no staging gold-set score", why)

    def test_unfinished_run_is_skipped_and_stops(self):
        g.record_scores("aaa", {"bridge": None}, self.p)
        self.assertTrue(g.gate_state(g.read_records(self.p), "aaa")[0])

    def test_rerun_same_sha_compares_to_other_sha(self):
        g.record_scores("aaa", {"bridge": (20, 20, 54)}, self.p)
        g.record_scores("bbb", {"bridge": (18, 20, 50)}, self.p)
        rows = g.record_scores("bbb", {"bridge": (20, 20, 50)}, self.p)  # rerun of bbb, now green
        self.assertFalse(rows[0]["dropped"])
        self.assertFalse(g.gate_state(g.read_records(self.p), "bbb")[0])
        self.assertFalse(g.gate_state(g.read_records(self.p), "bbb")[0])


    def test_last_score_ignores_skipped_rows(self):
        # a skipped suite row (no gold set yet) crashed record_scores during the v76 gate run
        recs = [{"kind": "score", "target": "staging", "suite": "talk", "sha": "a", "skipped": True}]
        self.assertIsNone(g.last_score(recs, "talk", before_sha="b"))


if __name__ == "__main__":
    unittest.main()

