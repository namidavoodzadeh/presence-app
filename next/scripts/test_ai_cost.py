import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_cost as a


class AiCost(unittest.TestCase):
    def test_exact_cents_prices_cache_writes_and_reads(self):
        # 1M Sonnet 5.5 input = 300c; a cache write is 1.25x, a read 0.05x; output 1500c per million
        self.assertAlmostEqual(a.exact_cents("claude-sonnet-5-5", 1_000_000, 0), 300)
        self.assertAlmostEqual(a.exact_cents("claude-sonnet-5-5", 0, 0, 1_000_000), 375)
        self.assertAlmostEqual(a.exact_cents("claude-sonnet-5-5", 0, 0, 0, 1_000_000), 15)
        self.assertAlmostEqual(a.exact_cents("claude-haiku-5-5", 0, 0, 0, 1_000_000), 10)   # Haiku reads are 0.1x
        self.assertAlmostEqual(a.exact_cents("claude-haiku-5-5", 0, 1_000_000), 500)

    def test_unpriced_model_takes_the_worst_rate(self):
        self.assertAlmostEqual(a.exact_cents("claude-unknown", 1_000_000, 0), 300)

    def test_model_month_adds_up(self):
        pc = dict(turn=1.0, repair=0.5, safety=0.0, finish=2.0, live=0.1, analyse=0.5, rewrite=1.0, verify=0.5)
        m = a.model_month(pc, sessions=2, turns=10, repair_share=0.5, bridges=1)
        self.assertAlmostEqual(m["talk"], 2 * (10 * 1.25 + 2.0))
        self.assertAlmostEqual(m["bridge"], 0.3 + 0.5 + 1.0 + 0.5)
        self.assertAlmostEqual(m["total"], m["talk"] + m["bridge"])
        self.assertAlmostEqual(a.model_month(pc, sessions=2, turns=10, repair_share=0.5, bridges=1, users=100)["total"], m["total"] * 100)


if __name__ == "__main__":
    unittest.main()
