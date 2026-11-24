import os, stat, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_hosted_test_pair as hp
import supabase_env as se

A, B = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
q = lambda v: "'" + str(v).replace("'", "''") + "'"


class HostedTestPair(unittest.TestCase):
    def test_profile_is_test_kind_never_preview(self):
        sql = hp.profile_sql(q, "{}", A, "Tove (test)", "#8A6F4E")
        self.assertIn("'test'", sql); self.assertIn("false, false, false", sql)
        self.assertNotIn("links", sql)

    def test_bad_ids_refused(self):
        with self.assertRaises(ValueError): hp.profile_sql(q, "{}", "x'; drop table profiles;--", "n", "c")
        with self.assertRaises(ValueError): hp.left_sql(q, ["'; --"])
        with self.assertRaises(ValueError): hp.left_sql(q, [])

    def test_check_names_both_ids_and_counts_only(self):
        sql = hp.left_sql(q, [A, B])
        self.assertIn(A, sql); self.assertIn(B, sql); self.assertTrue(sql.startswith("select"))

    def test_credentials_are_invalid_domain_and_distinct(self):
        v = hp.new_credentials()
        self.assertTrue(v["HOSTED_PAIR_A_EMAIL"].endswith(".invalid") and v["HOSTED_PAIR_B_EMAIL"].endswith(".invalid"))
        self.assertNotEqual(v["HOSTED_PAIR_A_PASSWORD"], v["HOSTED_PAIR_B_PASSWORD"])

    def test_tove_credentials_and_file_are_scoped_to_the_worktree(self):
        with tempfile.TemporaryDirectory() as d:
            os.environ["PRESENCE_REPO_ROOT"] = d
            try:
                self.assertEqual(hp.tove_file(), Path(d) / "ops/secrets/two-phone-tove.env")
            finally:
                del os.environ["PRESENCE_REPO_ROOT"]
        v = hp.new_tove_credentials()
        self.assertTrue(v["PRESENCE_TOVE_EMAIL"].endswith(".invalid"))
        self.assertTrue(v["PRESENCE_TOVE_PASSWORD"])

    def test_seed_tove_requires_an_unlinked_profile_and_proves_sign_in(self):
        class SP:
            q = staticmethod(q)
            DEFAULT_SETTINGS = "{}"
            @staticmethod
            def ensure_user(env, email, password, persona):
                self.assertEqual(persona, "two-phone-tove")
                return A
        calls = []
        with tempfile.TemporaryDirectory() as d:
            os.environ["PRESENCE_REPO_ROOT"] = d
            try:
                uid, status = hp.seed_tove(
                    {}, SP, lambda env, sql: calls.append(sql) or ((201, "[]") if len(calls) == 1 else (200, '[{"profiles": 1, "links": 0, "invites": 0}]')),
                    sign_in=lambda env, email, password: 200,
                )
                self.assertEqual((uid, status), (A, 200))
                saved = hp.read_env(hp.tove_file())
                self.assertEqual(saved["PRESENCE_TOVE_ID"], A)
                self.assertTrue(saved["PRESENCE_TOVE_EMAIL"].endswith(".invalid"))
                self.assertEqual(stat.S_IMODE(hp.tove_file().stat().st_mode), 0o600)
            finally:
                del os.environ["PRESENCE_REPO_ROOT"]
        self.assertIn("Tove (test phone)", calls[0])
        self.assertIn("links", calls[1])

    def test_env_file_is_mode_600(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "s/x.env"; hp.write_env(p, {"K": "v"})
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600); self.assertEqual(hp.read_env(p), {"K": "v"})

    def test_production_loader_allows_this_step_only_by_name(self):
        self.assertIn("hosted_test_pair", se.PRODUCTION_STEPS)
        with self.assertRaises(SystemExit): se.load_production("hosted_test_pairs")

    def test_remove_deletes_only_listed_test_ids(self):
        calls = []
        class SP:
            q = staticmethod(q)
            @staticmethod
            def auth_call(env, m, path, body=None): calls.append((m, path)); return 204, {}
        sqls = []
        with tempfile.TemporaryDirectory() as d:
            os.environ["PRESENCE_REPO_ROOT"] = d
            try:
                hp.write_env(hp.pair_file(), {"HOSTED_PAIR_A_ID": A, "HOSTED_PAIR_B_ID": B})
                rc = hp.remove({}, SP, lambda env, s: (sqls.append(s) or (200, "[]")))
                self.assertEqual(rc, 0); self.assertFalse(hp.pair_file().exists())
            finally:
                del os.environ["PRESENCE_REPO_ROOT"]
        self.assertEqual(len(sqls), 2)
        for s, i in zip(sqls, (A, B)):
            self.assertIn(i, s); self.assertIn("account_kind = 'test'", s)
        self.assertEqual(calls, [("DELETE", f"/auth/v1/admin/users/{A}"), ("DELETE", f"/auth/v1/admin/users/{B}")])


if __name__ == "__main__":
    unittest.main()
