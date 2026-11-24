import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging_journeys as sj


def q(v):
    if v is None:
        return "null"
    if isinstance(v, (list, tuple)):
        return "array[" + ",".join(q(x) for x in v) + "]::text[]"
    if isinstance(v, dict):
        return "'{}'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


IDS = {p: f"id-{p}" for p in sj.persona_ids()}


class Journeys(unittest.TestCase):
    def test_every_account_is_a_flagged_journey_persona(self):
        self.assertTrue(all(p.startswith("journey") for p in sj.persona_ids()))
        self.assertEqual(len(set(sj.persona_ids())), 9)
        for s in sj.STATES:
            sql = sj.plan_sql(q, s, IDS)
            self.assertEqual(sql.count("'test', 'preview'"), 1 + len(sj.COMPANIONS[s]) + (1 if sj.REMOVED[s] else 0))
            self.assertNotIn("'nami'", sql)

    def test_companions_are_never_shared_between_fixtures(self):
        names = [c[0] for s in sj.STATES for c in sj.COMPANIONS[s]] + [sj.REMOVED[s][0] for s in sj.STATES if sj.REMOVED[s]]
        self.assertEqual(len(names), len(set(names)))

    def test_row_ids_are_the_same_every_run(self):
        self.assertEqual(sj.plan_sql(q, "month1", IDS), sj.plan_sql(q, "month1", IDS))

    def test_day1_has_a_profile_and_nothing_else(self):
        sql = sj.plan_sql(q, "day1", IDS)
        self.assertEqual(sql.count("insert into"), 1)

    def test_sizes_match_the_brief(self):
        week, month = sj.plan_sql(q, "week1", IDS), sj.plan_sql(q, "month1", IDS)
        self.assertEqual(week.count("insert into bridges"), 4)          # one message each way, one sealed card, one withdrawn
        self.assertEqual(week.count("insert into links"), 2)            # one person joined, one removed
        self.assertEqual(month.count("insert into links"), 4)           # three people, one removed
        self.assertEqual(month.count("insert into check_ins "), 2)
        self.assertEqual(month.count("insert into drafts"), 1)
        self.assertEqual(month.count("insert into parked_notes"), 1)
        self.assertGreaterEqual(month.count("insert into beliefs"), 12)

    def test_psy_4d_each_of_week1_and_month1_holds_a_sealed_card_a_set_aside_item_and_a_removed_person(self):
        self.assertIsNone(sj.REMOVED["day1"])
        for s in ("week1", "month1"):
            sql = sj.plan_sql(q, s, IDS)
            self.assertEqual(sql.count("'set_aside', 'not'"), 1)
            self.assertEqual(sql.count("'removed'"), 3)            # the link, its prefs row is not counted; the event and the link status
            self.assertIn("'removed', false", sql)                  # the removal event is invisible to the removed person (QA-B403)
            self.assertEqual(sql.count("'withdrawn'"), 1)
            self.assertIn("now() + interval '3 days'", sql)         # the sealed card

    def test_no_model_call_and_no_ledger_write(self):
        for s in sj.STATES:
            sql = sj.plan_sql(q, s, IDS)
            self.assertNotIn("usage_ledger", sql)
            self.assertNotIn("engine_calls", sql)

    def test_the_sweep_runs_before_the_fixture_and_keeps_money_and_safety_records(self):
        parts = sj.scripts(q, ["week1"], IDS, {}, True)
        self.assertEqual([p[0] for p in parts], ["profiles", "reset", "seed week1"])
        sweep = parts[1][1]
        self.assertIn("p.persona like 'journey%'", sweep)
        for t in sj.KEEP_TABLES:
            self.assertIn(f"'{t}'", sweep)

    def test_every_run_sweeps_first(self):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(sj.main(["--dry-run", "week1"]), 0)
        self.assertIn("journey reset refused", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
