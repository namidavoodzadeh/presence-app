"""rotate_preview_secret: fake files and a fake Management API only; no value may reach stdout."""
import contextlib, io, json, os, stat, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import rotate_preview_secret as r  # noqa: E402

OLD = "old-value-SECRETAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.d = Path(self.tmp.name)
        (self.d / "repo/ops/secrets").mkdir(parents=True); (self.d / "home/secrets").mkdir(parents=True)
        for p in (self.d / "repo/ops/secrets/qa-preview.env", self.d / "home/secrets/preview-device.env"):
            p.write_text(f"{r.NAME}={OLD}\n")
        os.environ["PRESENCE_HOME_ROOT"] = str(self.d / "home")
        self.posts = []
        self.saved = (r.call, r.load_production, r.load_public_production, r.login_status)
        r.load_production = lambda step: {"SUPABASE_PROJECT_REF": "ref", "SUPABASE_ACCESS_TOKEN": "tok"}
        r.load_public_production = lambda: {"SUPABASE_URL": "https://x.example", "SUPABASE_ANON_KEY": "anon"}
        def fake_call(env, method, path, body=None, **k):
            if method == "POST": self.posts.append(body); return 201, ""
            return 200, json.dumps([{"name": r.NAME, "value": "digestvalue"}])
        r.call = fake_call
        self.logins = []
        def fake_login(base, anon, persona, value):
            self.logins.append((persona, value)); return 200 if value == self.posts[-1][0]["value"] else 401
        r.login_status = fake_login

    def tearDown(self):
        r.call, r.load_production, r.load_public_production, r.login_status = self.saved
        os.environ.pop("PRESENCE_HOME_ROOT", None); self.tmp.cleanup()

    def run_main(self, *extra):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = r.main(["--repo-root", str(self.d / "repo"), "--record", str(self.d / "rec.jsonl"), *extra])
        return rc, out.getvalue()

    def test_sets_only_the_one_secret_matches_files_and_logs_nothing_secret(self):
        rc, out = self.run_main()
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.posts), 1); self.assertEqual([s["name"] for s in self.posts[0]], [r.NAME])
        new = self.posts[0][0]["value"]
        self.assertNotEqual(new, OLD)
        for p in (self.d / "repo/ops/secrets/qa-preview.env", self.d / "home/secrets/preview-device.env"):
            self.assertEqual(r.read_secret_file(p), new)
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
            self.assertEqual(r.read_secret_file(p.with_name(p.name + ".prev")), OLD)
        self.assertEqual(self.logins[0], ("sam", new))
        rec = (self.d / "rec.jsonl").read_text()
        for secret in (new, OLD):
            self.assertNotIn(secret, out); self.assertNotIn(secret, rec)
        line = json.loads(rec); self.assertEqual(line["login_status"], 200); self.assertFalse(line["value_printed"])

    def test_failed_hosted_set_is_red_and_does_no_login(self):
        r.call = lambda env, method, path, body=None, **k: (500, "boom") if method == "POST" else (200, "[]")
        rc, out = self.run_main()
        self.assertEqual(rc, 1); self.assertEqual(self.logins, []); self.assertIn("RED", out)

    def test_rollback_value_from_protected_file(self):
        keep = self.d / "keep.env"; keep.write_text(f"{r.NAME}=known-value-123\n")
        rc, out = self.run_main("--value-from", str(keep))
        self.assertEqual(rc, 0); self.assertEqual(self.posts[0][0]["value"], "known-value-123")
        self.assertNotIn("known-value-123", out)


if __name__ == "__main__":
    unittest.main()
