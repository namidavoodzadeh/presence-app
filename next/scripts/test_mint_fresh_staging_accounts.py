import os, stat, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mint_fresh_staging_accounts as m  # noqa: E402


class Mint(unittest.TestCase):
    def test_credentials_are_fresh_fictional_and_distinct(self):
        a, b = m.new_credentials(), m.new_credentials()
        self.assertEqual(sorted(a), ["FRESH_DARK_EMAIL", "FRESH_DARK_PASSWORD", "FRESH_LIGHT_EMAIL", "FRESH_LIGHT_PASSWORD", "FRESH_TL1_EMAIL", "FRESH_TL1_PASSWORD"])
        for k, v in a.items():
            if k.endswith("EMAIL"): self.assertTrue(v.endswith("@staging.presence.invalid"))
            else: self.assertGreaterEqual(len(v), 24)
        self.assertEqual(len({a["FRESH_LIGHT_EMAIL"], a["FRESH_DARK_EMAIL"], a["FRESH_TL1_EMAIL"]}), 3)
        self.assertNotEqual(a["FRESH_LIGHT_PASSWORD"], b["FRESH_LIGHT_PASSWORD"])

    def test_env_file_is_mode_600_and_round_trips(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "sub" / "fresh.env"
            m.write_env(p, {"FRESH_LIGHT_EMAIL": "a@x.invalid", "FRESH_LIGHT_PASSWORD": "p-w"})
            self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)
            self.assertEqual(m.read_env(p), {"FRESH_LIGHT_EMAIL": "a@x.invalid", "FRESH_LIGHT_PASSWORD": "p-w"})
            m.write_env(p, {"K": "v"})
            self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600)

    def test_dry_run_touches_nothing(self):
        self.assertEqual(m.main(["--dry-run"]), 0)


if __name__ == "__main__":
    unittest.main()
