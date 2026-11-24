"""set_function_secrets: the preview device secret comes from the file of the project being set (Q-ENG-SETSECRETS-1). Fake files only."""
import os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import set_function_secrets as s  # noqa: E402

NAME = "PRESENCE_PREVIEW_DEVICE_SECRET"


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); d = Path(self.tmp.name)
        (d / "secrets").mkdir()
        (d / "secrets/preview-device.env").write_text(f"{NAME}=hosted-value-AAAA\n")
        self.d = d
        self.saved = (s.ROOT, os.environ.get("PRESENCE_SUPABASE_ENV"))
        s.ROOT = d

    def tearDown(self):
        s.ROOT = self.saved[0]
        if self.saved[1] is None: os.environ.pop("PRESENCE_SUPABASE_ENV", None)
        else: os.environ["PRESENCE_SUPABASE_ENV"] = self.saved[1]
        self.tmp.cleanup()

    def test_hosted_reads_the_hosted_file(self):
        os.environ.pop("PRESENCE_SUPABASE_ENV", None)
        self.assertEqual(s.persistent_preview_device_secret(), "hosted-value-AAAA")

    def test_staging_reads_staging_env_not_the_hosted_file(self):
        (self.d / "secrets/staging.env").write_text(f"SUPABASE_PROJECT_REF=x\n{NAME}=staging-value-BBBB\n")
        os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
        self.assertEqual(s.persistent_preview_device_secret(), "staging-value-BBBB")

    def test_staging_without_its_own_value_stops_and_never_falls_back(self):
        (self.d / "secrets/staging.env").write_text("SUPABASE_PROJECT_REF=x\n")
        os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
        with self.assertRaises(SystemExit) as cm:
            s.persistent_preview_device_secret()
        self.assertNotIn("hosted-value", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
