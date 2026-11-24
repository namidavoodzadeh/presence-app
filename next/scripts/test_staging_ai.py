import json, sys, tempfile, time, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent))
import staging_ai as sa  # noqa: E402

GOOD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"


class Seam(unittest.TestCase):
    def test_check_sits_before_every_sum_and_only_for_non_eval_people(self):
        sql = sa.capped_sql()
        seam = sql.index(f"from public.{sa.SEAM_TABLE} where person = p_person")
        self.assertLess(seam, sql.index("into person_used"))
        self.assertLess(seam, sql.index("into day_used"))
        self.assertLess(seam, sql.index("into month_used"))        # 0068 has no lifetime total; the month sum is the last read
        self.assertIn("p_person is not null and not is_eval", sql[seam - 60:seam + 60])
        self.assertIn("'error', 'total_limit'", sql[seam:seam + 400])

    def test_table_exists_before_the_function_and_has_no_policy(self):
        sql = sa.capped_sql()
        self.assertLess(sql.index(f"create table if not exists public.{sa.SEAM_TABLE}"), sql.index("create or replace function public.ledger_reserve"))
        self.assertIn("enable row level security", sql)
        self.assertNotIn("create policy", sql)

    def test_the_cap_numbers_still_apply(self):
        sql = sa.capped_sql()
        self.assertIn(f"day_cap bigint := {sa.CAP_CENTS} * 10000", sql)

    def test_cap_is_built_from_the_credit_cycle_ledger(self):               # 0033's lifetime cap would overwrite 0067/0068's month logic on staging
        sql = sa.capped_sql()
        self.assertTrue(str(sa.MIG).endswith("0068_ai_credit_cycle.sql"))
        self.assertIn("month_limit", sql); self.assertIn("ai_cycle_start", sql); self.assertNotIn("total_cap bigint", sql)

    def test_person_extra_lookup_sits_before_the_person_sum(self):
        sql = sa.capped_sql()
        self.assertLess(sql.index(f"from public.{sa.EXTRA_TABLE} where person = p_person"), sql.index("into person_used"))
        self.assertLess(sql.index(f"create table if not exists public.{sa.EXTRA_TABLE}"), sql.index("create or replace function public.ledger_reserve"))

    def test_extra_refuses_bad_input_and_the_production_project_without_a_call(self):
        env = {"SUPABASE_URL": "https://prod.supabase.co"}
        with mock.patch.object(sa, "run_sql") as r, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co/"}):
            self.assertEqual(sa.person_extra("x'; drop table profiles; --", "100"), 1)
            self.assertEqual(sa.person_extra(GOOD, "301"), 1)
            self.assertEqual(sa.person_extra(GOOD, "0"), 1)
            self.assertEqual(sa.person_extra(GOOD, "150"), 1)      # production
            self.assertEqual(sa.person_extra_off("--all"), 1)
            r.assert_not_called()

    def test_not_in_a_migration(self):
        mig = Path(__file__).resolve().parents[2] / "supabase/migrations"
        self.assertFalse([p.name for p in mig.glob("*.sql") if sa.SEAM_TABLE in p.read_text()])

    def test_refuses_a_non_uuid_without_a_call(self):
        with mock.patch.object(sa, "run_sql") as r, mock.patch.object(sa, "load"):
            self.assertEqual(sa.limit_on("x'; drop table profiles; --"), 1)
            self.assertEqual(sa.limit_off("all; drop"), 1)
            r.assert_not_called()

    def test_refuses_the_production_project(self):
        env = {"SUPABASE_URL": "https://prod.supabase.co"}
        with mock.patch.object(sa, "run_sql") as r, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co/"}):
            for call in (lambda: sa.limit_on(GOOD), lambda: sa.limit_off(None), sa.limit_list, sa.cap):
                self.assertEqual(call(), 1)
            r.assert_not_called()

    def test_on_only_inserts_a_test_kind_account(self):
        env = {"SUPABASE_URL": "https://stg.supabase.co"}
        seen = []

        def fake(_env, sql):
            seen.append(sql)
            return 201, ("[]" if sql.startswith("select") else "[]")
        with mock.patch.object(sa, "run_sql", side_effect=fake), mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}):
            self.assertEqual(sa.limit_on(GOOD), 1)  # the account is not on the list afterwards (not a test-kind account): refused
        self.assertIn("account_kind = 'test'", seen[0])
        self.assertIn(f"id = '{GOOD}'", seen[0])

    def test_on_succeeds_when_the_row_is_there(self):
        env = {"SUPABASE_URL": "https://stg.supabase.co"}
        with mock.patch.object(sa, "run_sql", side_effect=lambda e, q: (201, '[{"n":1}]' if q.startswith("select") else "[]")), \
                mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}):
            self.assertEqual(sa.limit_on(GOOD), 0)
            self.assertEqual(sa.limit_off("--all"), 0)


class SafetyVariant(unittest.TestCase):
    def test_safety_flag_builds_from_0073_and_keeps_the_cap_seam_and_extra(self):
        plain, safe = sa.capped_sql(550), sa.capped_sql(550, safety=True)
        self.assertNotIn("safety_read", plain)                       # default unchanged: 0068's functions
        self.assertIn("safety_ceiling", safe)
        self.assertIn("'safety_daily_ceiling_cents', 300", safe)
        self.assertIn("550 * 10000", safe); self.assertIn("'daily_cap_cents', 550", safe)
        self.assertIn(sa.SEAM_TABLE, safe); self.assertIn(sa.EXTRA_TABLE, safe)   # the seam and the person extra are carried into the safety build too
        self.assertIn("'owner_preview_extra_cents', 0", safe)


class OwnerApprovedCap(unittest.TestCase):
    def test_cap_args_accepts_the_dated_owner_approval(self):
        self.assertEqual(sa.cap_args(["3000", "--safety", "--owner-approved", "2026-11-20"]),
                         (3000, sa.date(2026, 11, 20)))

    def test_cap_rejects_lift_without_safety_or_dated_approval(self):
        env = {"SUPABASE_URL": "https://stg.supabase.co"}
        with mock.patch.object(sa, "run_sql") as sql, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}), \
                mock.patch.object(sa.sys, "argv", ["staging_ai.py", "cap", "3000"]):
            self.assertEqual(sa.cap(), 1)
        with mock.patch.object(sa, "run_sql") as sql, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}), \
                mock.patch.object(sa.sys, "argv", ["staging_ai.py", "cap", "3000", "--safety"]):
            self.assertEqual(sa.cap(), 1)
        sql.assert_not_called()

    def test_cap_accepts_owner_approved_lift_and_5000_ceiling(self):
        env = {"SUPABASE_URL": "https://stg.supabase.co"}
        with mock.patch.object(sa, "run_sql", return_value=(201, "")) as sql, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}), \
                mock.patch.object(sa.sys, "argv", ["staging_ai.py", "cap", "5000", "--safety", "--owner-approved", "2026-11-20"]):
            self.assertEqual(sa.cap(), 0)
            self.assertIn("5000 * 10000", sql.call_args.args[1])
        with mock.patch.object(sa, "run_sql") as sql, mock.patch.object(sa, "load", return_value=env), \
                mock.patch("supabase_env.load_public_production", return_value={"SUPABASE_URL": "https://prod.supabase.co"}), \
                mock.patch.object(sa.sys, "argv", ["staging_ai.py", "cap", "5001", "--safety", "--owner-approved", "2026-11-20"]):
            self.assertEqual(sa.cap(), 1)
        sql.assert_not_called()


class EvalDoor(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.lock = self.dir / ".eval-door.lock"
        self.patch = mock.patch.object(sa, "EVAL_LOCK", self.lock)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_refuses_a_fresh_door_and_replaces_a_stale_one(self):
        self.assertTrue(sa.acquire_eval_lock())
        first = json.loads(self.lock.read_text())
        self.assertEqual(first["pid"], sa.os.getpid())
        self.assertFalse(sa.acquire_eval_lock())
        self.lock.write_text(json.dumps({"pid": 41, "started_at": int(time.time()) - sa.EVAL_LOCK_STALE_SECONDS - 1}))
        self.assertTrue(sa.acquire_eval_lock())
        self.assertEqual(json.loads(self.lock.read_text())["pid"], sa.os.getpid())

    def test_lock_is_in_the_shared_operations_home(self):
        self.assertEqual(sa.OPERATIONS_HOME / "outputs/engine/.eval-door.lock",
                         Path(__file__).resolve().parents[4] / "outputs/engine/.eval-door.lock")

    def test_eval_close_releases_the_door(self):
        self.lock.write_text(json.dumps({"pid": 41, "started_at": int(time.time())}))
        env = {"SUPABASE_PROJECT_REF": "staging-ref"}
        with mock.patch.object(sa, "load", return_value=env), mock.patch.object(sa, "call", return_value=(204, "")):
            self.assertEqual(sa.eval_close(), 0)
        self.assertFalse(self.lock.exists())

if __name__ == "__main__":
    unittest.main()
