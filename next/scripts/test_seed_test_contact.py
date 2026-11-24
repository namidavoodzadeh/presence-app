import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_test_contact as st


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


class SeedTestContact(unittest.TestCase):
    def test_plan_flags_links_and_stays_real(self):
        sql = st.plan_sql(q, "jan-id", "nami-id")
        self.assertIn("account_kind", sql)
        self.assertIn("'test'", sql)
        self.assertIn("false, false, false", sql)          # not example, not practice, not preview
        self.assertEqual(sql.count("'partner'"), 4)        # both link_prefs rows, insert + update
        self.assertTrue(sql.startswith("begin;") and sql.endswith("commit;"))
        self.assertNotIn("beliefs", sql)                    # holds no map, no real person's data

    def test_pair_plan_links_only_to_jan_and_is_flagged(self):
        sql = st.plan_pair_sql(q, "nt-id", "jan-id")
        self.assertIn("'namitest'", sql)
        self.assertIn("'Nami (test)'", sql)
        self.assertIn("'test'", sql)
        self.assertIn("false, false, false", sql)
        self.assertEqual(sql.count("'partner'"), 4)
        self.assertIn("values ('jan-id', 'nt-id', 'active')", sql)
        self.assertNotIn("beliefs", sql)

    def test_link_pair_is_sorted(self):
        sql = st.plan_sql(q, "zzz", "aaa")
        self.assertIn("values ('aaa', 'zzz', 'active')", sql)

    def test_migration_allows_test_with_rollback(self):
        text = (Path(__file__).resolve().parents[2] / "supabase/migrations/0046_account_kind_test.sql").read_text()
        self.assertIn("'test'", text)
        self.assertIn("-- rollback", text)


if __name__ == "__main__":
    unittest.main()
