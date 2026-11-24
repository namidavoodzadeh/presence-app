import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_w34_calibration as b

BANNED = ("suicid", "kill myself", "hurt myself", "end it", "self-harm", "die")


class SeedingTests(unittest.TestCase):
    def test_about_a_third_seeded_all_kinds_used(self):
        pl = b.plan()
        seeded = [r for r in pl if r["seed"]]
        self.assertAlmostEqual(len(seeded) / len(pl), 1 / 3, delta=0.05)
        self.assertEqual({r["seed"] for r in seeded}, set(b.SEEDS))

    def test_seed_adds_exactly_one_turn_and_is_deterministic(self):
        a, c = b.plan(), b.plan()
        self.assertEqual(a, c)
        p = {x["id"]: x for x in b.personas()}
        for r in a:
            base = len(b.turns_for(p[r["persona"]]))
            self.assertEqual(len(r["turns"]), base + (1 if r["seed"] else 0))

    def test_no_seed_carries_risk_language(self):
        for kind, (targets, text) in b.SEEDS.items():
            self.assertFalse(any(w in text.lower() for w in BANNED), kind)
            self.assertTrue(all(t in b.CRITERIA for t in targets), kind)
            self.assertNotIn("c8_not_safety_turn", targets)

    def test_dry_run_makes_no_network_call(self):
        import io, contextlib, unittest.mock as m
        with m.patch.object(b, "load_env", side_effect=AssertionError("network")), \
             m.patch.object(sys, "argv", ["x", "--dry-run", "--limit", "6"]), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(b.main(), 0)
        self.assertIn("0 calls", out.getvalue())


if __name__ == "__main__":
    unittest.main()
