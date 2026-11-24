import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import staging_pair as sp

A, B = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
q = lambda v: "'" + str(v).replace("'", "''") + "'"


class StagingPair(unittest.TestCase):
    def test_clean_touches_only_the_two(self):
        sql = sp.clean_sql(q, A, B)
        self.assertEqual(sql.count(A), sql.count(B)); self.assertGreaterEqual(sql.count(A), 4)
        self.assertIn("delete from links", sql); self.assertIn("delete from invites", sql)
        self.assertNotIn("profiles", sql); self.assertNotIn("auth", sql)
        self.assertTrue(sql.startswith("begin;") and sql.endswith("commit;"))

    def test_refuses_bad_ids(self):
        for a, b in [("x", B), (A, A), (A, "'; drop table links;--"), ("", ""), (A, None)]:
            with self.assertRaises(ValueError): sp.clean_sql(q, a, b)
            with self.assertRaises(ValueError): sp.left_sql(q, a, b)

    def test_no_wildcards(self):
        sql = sp.clean_sql(q, A, B)
        self.assertNotIn("1=1", sql); self.assertNotIn("true", sql.lower())
        # every delete has a where clause naming the persona ids
        for stmt in [s for s in sql.split(";") if s.strip().startswith("delete")]:
            self.assertIn("where", stmt); self.assertIn(A, stmt)

    def test_profiles_are_flagged_test_and_not_preview(self):
        import seed_preview as seed
        sql = sp.profile_sql(q, seed, A, "Pia (test)", "#7A5C9E")
        self.assertIn("'test'", sql); self.assertIn("false, false, false", sql)


if __name__ == "__main__":
    unittest.main()
