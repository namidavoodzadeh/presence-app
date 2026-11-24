import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_budget_alert as ab  # noqa: E402


def snap(level, cents, cycle="2026-10-25", cap=19000):
    return {"level": level, "month_cents": cents, "month_cap_cents": cap, "month_pct": round(cents * 100 / cap, 1),
            "cycle_starts_at": f"{cycle}T00:00:00+00:00", "month_opens_at": "2026-11-25T00:00:00+00:00"}


class Alert(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.state, self.alerts = d / "state.json", d / "alerts.jsonl"

    def go(self, s, env="hosted"):
        return ab.run(s, env, self.state, self.alerts, now=1.0)

    def rows(self):
        return [json.loads(l) for l in self.alerts.read_text().splitlines()] if self.alerts.exists() else []

    def test_ok_writes_nothing(self):
        self.assertIsNone(self.go(snap("ok", 100)))
        self.assertEqual(self.rows(), [])

    def test_each_level_once_per_cycle(self):
        self.go(snap("warn", 9500)); self.go(snap("warn", 9700))
        self.assertEqual([r["level"] for r in self.rows()], ["warn"])
        self.go(snap("high", 15300)); self.go(snap("high", 15400))
        self.go(snap("critical", 18100)); self.go(snap("critical", 18900))
        self.assertEqual([r["level"] for r in self.rows()], ["warn", "high", "critical"])

    def test_a_jump_writes_one_row_for_the_highest_level(self):
        self.go(snap("critical", 18200))
        self.assertEqual([r["level"] for r in self.rows()], ["critical"])
        self.go(snap("high", 15500))                      # falling back (a setting raised the cap) never re-announces
        self.assertEqual(len(self.rows()), 1)

    def test_new_cycle_resets(self):
        self.go(snap("critical", 18200))
        self.go(snap("warn", 9600, cycle="2026-11-25"))
        self.assertEqual([r["level"] for r in self.rows()], ["critical", "warn"])

    def test_row_has_only_numbers_and_dates(self):
        row = self.go(snap("high", 15500), env="staging")
        self.assertEqual(set(row), {"ts", "type", "env", "level", "pct", "month_cents", "month_cap_cents", "opens_at", "message"})
        self.assertEqual(row["type"], "ai_budget_level")
        self.assertIn("15,500 of 19,000", row["message"])
        self.assertIn("resets 2026-11-25", row["message"])

    def test_old_snapshot_without_level_is_ignored(self):
        self.assertIsNone(ab.decide({"total_cents": 5}, None, "hosted", 1.0)[0])

    def test_dry_run_writes_nothing(self):
        row = ab.run(snap("warn", 9600), "staging", self.state, self.alerts, now=1.0, dry_run=True)
        self.assertEqual(row["level"], "warn")
        self.assertFalse(self.alerts.exists() or self.state.exists())


if __name__ == "__main__":
    unittest.main()
