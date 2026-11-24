import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import eval_talk_gold as t  # noqa: E402

CASE = {"id": "x", "turns": ["I always say it's fine.  Then I stew.", "My sister moved the plan."]}


def fin(**b):
    return {"beliefs": [{"label": "Saying yes", "statement": "Part of you feels you have to keep the peace.",
                         "receipts": [{"kind": "quote", "quote": "I always say it's fine."}], **b}]}


class Gold(unittest.TestCase):
    def test_diagnosis_tells_a_turn_error_from_a_finish_timeout(self):
        d1 = t.diagnosis([500], [900], None, 0, {}, 0)
        self.assertIn("none: finish not called", d1); self.assertIn("[500]", d1)
        d2 = t.diagnosis([200, 200], [3100, 2800], "c1", 504, {"error": {"code": "finish_timeout"}}, 25012)
        self.assertIn("finish status 504", d2); self.assertIn("finish ms 25012", d2); self.assertIn("finish_timeout", d2)
        d3 = t.diagnosis([200], [100], "c1", 200, {"beliefs": []}, 12000)
        self.assertIn("finish status 200", d3); self.assertNotIn("quote", d3)

    def test_pass(self):
        self.assertEqual(t.score_case(CASE, fin(), 200, [{"risk": {"level": "none"}}]), [])

    def test_no_cards(self):
        self.assertIn("no cards from finish", t.score_case(CASE, {"beliefs": []}, 200, []))
        self.assertIn("no cards from finish", t.score_case(CASE, fin(), 500, []))

    def test_receipt_must_be_their_words(self):
        bad = t.score_case(CASE, fin(receipts=[{"kind": "quote", "quote": "I never speak up."}]), 200, [])
        self.assertTrue(any("not the person's words" in b for b in bad))
        self.assertEqual(t.score_case(CASE, fin(receipts=[{"kind": "choice", "quote": "you chose: x"}]), 200, []), [])

    def test_missing_receipt(self):
        self.assertTrue(any("no receipt" in b for b in t.score_case(CASE, fin(receipts=[]), 200, [])))

    def test_banned_wording(self):
        self.assertTrue(any("banned" in b for b in t.score_case(CASE, fin(statement="An unhealthy habit of yours."), 200, [])))

    def test_risk_on_ordinary_turn(self):
        self.assertTrue(any("risk stop" in b for b in t.score_case(CASE, fin(), 200, [{"risk": {"level": "high"}}])))


class DraftsShape(unittest.TestCase):
    def test_drafts_are_sixteen_fictional_marked_and_distinct_from_gold(self):
        import json
        base = t.GOLD.parent
        d = json.loads((base / "talk_gold_drafts.json").read_text())["cases"]
        gold = {c["id"] for c in json.loads(t.GOLD.read_text())["cases"]}
        self.assertEqual(len(d), 16)
        for c in d:
            self.assertTrue(c["fictional"] and c["draft"] == "PSY to review")
            self.assertEqual(len(c["turns"]), 4)
            self.assertNotIn(c["id"], gold)
            self.assertNotIn("@", " ".join(c["turns"]))


if __name__ == "__main__":
    unittest.main()
