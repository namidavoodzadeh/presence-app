import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_kenning_map_people as sk


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


class KenningMapPeople(unittest.TestCase):
    def sql(self):
        return sk.plan_sql(q, {"namitest": "n-id", "jantest": "j-id"},
                           {"inestest": "i-id", "tomastest": "t-id", "daratest": "d-id"})

    def test_flagged_fictional_and_one_transaction(self):
        s = self.sql()
        self.assertTrue(s.startswith("begin;") and s.endswith("commit;"))
        self.assertEqual(s.count("'test')"), 3)
        self.assertNotIn("beliefs", s)

    def test_each_person_links_to_both_test_owners_in_both_directions(self):
        s = self.sql()
        self.assertEqual(s.count("insert into links"), 6)
        self.assertEqual(s.count("insert into link_prefs"), 12)
        self.assertIn("values ('i-id', 'n-id', 'active')", s)   # sorted pair

    def test_only_test_owners(self):
        self.assertEqual(sk.OWNERS, ("namitest", "jantest"))
        self.assertNotIn("'nami'", self.sql())


if __name__ == "__main__":
    unittest.main()
