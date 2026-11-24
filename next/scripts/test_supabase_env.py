"""sre-08: production Supabase keys stay out of lane environments. Fake files only, no real secrets."""
import io, os, subprocess, sys, tempfile, unittest, contextlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import supabase_env as se  # noqa: E402

PROD_SVC, STG_SVC = "prod-service-SECRETVALUE-111", "stg-service-SECRETVALUE-222"


def write(root: Path, name: str, svc: str):
    d = root / "secrets"; d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text("\n".join([
        f"SUPABASE_URL=https://{name}.example.co", f"SUPABASE_PROJECT_REF={name}ref",
        f"SUPABASE_ANON_KEY=anon-{name}-PUBLICVALUE", f"SUPABASE_SERVICE_ROLE_KEY={svc}",
        f"SUPABASE_ACCESS_TOKEN=tok-{name}-SECRETTOKEN"]) + "\n")


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        write(self.root, "supabase.env", PROD_SVC); write(self.root, "staging.env", STG_SVC)
        self.saved = dict(os.environ)
        for k in ("PRESENCE_SUPABASE_ENV", "PRESENCE_PROD_STEP"): os.environ.pop(k, None)
        os.environ["PRESENCE_HOME_ROOT"] = str(self.root)
        os.environ["HOME"] = str(self.root / "home"); (self.root / "home/Library/Application Support").mkdir(parents=True)
        (self.root / "home/Library/Application Support/PresenceHome").symlink_to(self.root)

    def test_rotated_service_key_replaces_the_legacy_one_and_goes_in_apikey_only(self):
        (self.root / "secrets/staging.env").write_text((self.root / "secrets/staging.env").read_text() + "PRESENCE_SERVICE_KEY=sb_secret_ROTATEDVALUE\n")
        env = se.load()
        self.assertEqual(env["SUPABASE_SERVICE_ROLE_KEY"], "sb_secret_ROTATEDVALUE")
        self.assertEqual(se.service_headers(env), {"apikey": "sb_secret_ROTATEDVALUE"})

    def test_legacy_jwt_keeps_its_bearer_header_and_a_missing_legacy_line_is_fine_once_the_new_key_is_set(self):
        self.assertEqual(se.service_headers({"SUPABASE_SERVICE_ROLE_KEY": "eyJabc.def.ghi"}), {"apikey": "eyJabc.def.ghi", "Authorization": "Bearer eyJabc.def.ghi"})
        f = self.root / "secrets/staging.env"
        f.write_text("".join(l + "\n" for l in f.read_text().splitlines() if not l.startswith("SUPABASE_SERVICE_ROLE_KEY")) + "PRESENCE_SERVICE_KEY=sb_secret_X\n")
        self.assertEqual(se.load()["SUPABASE_SERVICE_ROLE_KEY"], "sb_secret_X")

    def tearDown(self):
        os.environ.clear(); os.environ.update(self.saved); self.tmp.cleanup()

    def test_default_load_is_staging_never_production(self):
        self.assertEqual(se.load()["SUPABASE_SERVICE_ROLE_KEY"], STG_SVC)

    def test_production_env_flag_does_not_switch_load_to_production(self):
        os.environ["PRESENCE_SUPABASE_ENV"] = "production"
        self.assertEqual(se.load()["SUPABASE_SERVICE_ROLE_KEY"], STG_SVC)

    def test_production_only_for_deploy_and_drift_steps(self):
        self.assertEqual(se.load_production("deploy")["SUPABASE_SERVICE_ROLE_KEY"], PROD_SVC)
        self.assertEqual(se.load_production("drift")["SUPABASE_SERVICE_ROLE_KEY"], PROD_SVC)
        self.assertEqual(se.load_production("seed_test_contact")["SUPABASE_SERVICE_ROLE_KEY"], PROD_SVC)
        for step in ("", "eval", "lane", "golden"):
            with self.assertRaises(SystemExit) as c: se.load_production(step)
            self.assertNotIn(PROD_SVC, str(c.exception))

    def test_step_loader_follows_staging_flag(self):
        self.assertEqual(se.load_for_step("drift")["SUPABASE_SERVICE_ROLE_KEY"], PROD_SVC)
        os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
        self.assertEqual(se.load_for_step("drift")["SUPABASE_SERVICE_ROLE_KEY"], STG_SVC)

    def test_public_production_has_url_and_anon_only(self):
        pub = se.load_public_production()
        self.assertEqual(set(pub), {"SUPABASE_URL", "SUPABASE_ANON_KEY"})
        self.assertNotIn(PROD_SVC, repr(pub))

    def test_missing_key_error_names_keys_not_values(self):
        p = self.root / "secrets/supabase.env"
        p.write_text(f"SUPABASE_URL=https://x\nSUPABASE_SERVICE_ROLE_KEY={PROD_SVC}\n")
        with self.assertRaises(SystemExit) as c: se.load_production("deploy")
        self.assertIn("SUPABASE_ANON_KEY", str(c.exception)); self.assertNotIn(PROD_SVC, str(c.exception))

    def test_check_and_main_output_has_no_value(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out): se.main(["--check"])
        self.assertNotIn(STG_SVC, out.getvalue()); self.assertNotIn("SECRETTOKEN", out.getvalue())
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY: ", out.getvalue())

    def test_lane_scrub_drops_every_service_key(self):
        env = {"PATH": "/bin", "SUPABASE_SERVICE_ROLE_KEY": PROD_SVC, "SUPABASE_ACCESS_TOKEN": "t", "SUPABASE_DB_PASSWORD": "d", "HOME": "/h"}
        s = se.scrub_lane_env(env)
        self.assertEqual(s, {"PATH": "/bin", "HOME": "/h"})

    def test_run_agent_launch_has_no_production_service_key(self):
        script = Path(__file__).resolve().parents[2] / "scripts/run-agent.sh"
        text = script.read_text()
        self.assertIn("unset ANTHROPIC_API_KEY CODEX_API_KEY OPENAI_API_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD", text)


if __name__ == "__main__":
    unittest.main()
