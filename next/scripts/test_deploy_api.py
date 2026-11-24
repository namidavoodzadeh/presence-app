import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_api as d  # noqa: E402


class ProductionGuard(unittest.TestCase):
    def test_refuses_without_staging_or_production_flag(self):
        env = {k: v for k, v in os.environ.items() if k != "PRESENCE_SUPABASE_ENV"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(d, "load_for_step", return_value={"SUPABASE_PROJECT_REF": "x"}), \
                mock.patch.object(d.deploy_gate, "main") as gate, \
                mock.patch.object(d, "multipart") as up:
            self.assertEqual(d.main([]), 2)
            gate.assert_not_called()
            up.assert_not_called()

    def test_production_flag_reaches_the_gate(self):
        env = {k: v for k, v in os.environ.items() if k != "PRESENCE_SUPABASE_ENV"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(d, "load_for_step", return_value={"SUPABASE_PROJECT_REF": "x"}), \
                mock.patch.object(d.deploy_gate, "main", return_value=1) as gate:
            self.assertEqual(d.main(["--production"]), 3)
            gate.assert_called_once()


class Rollback(unittest.TestCase):
    def test_rollback_is_refused_on_the_live_server(self):
        env = {k: v for k, v in os.environ.items() if k != "PRESENCE_SUPABASE_ENV"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(d, "load_for_step", return_value={"SUPABASE_PROJECT_REF": "x"}), \
                mock.patch.object(d.deploy_gate, "main") as gate, \
                mock.patch.object(d, "multipart") as up:
            self.assertEqual(d.main(["--production", "--rollback"]), 2)
            gate.assert_not_called()
            up.assert_not_called()

    def test_staging_rollback_records_and_runs_no_gold_set(self):
        class Resp:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"version": 77}'
        with mock.patch.dict(os.environ, {"PRESENCE_SUPABASE_ENV": "staging"}), \
                mock.patch.object(d, "load_for_step", return_value={"SUPABASE_PROJECT_REF": "x", "SUPABASE_ACCESS_TOKEN": "t"}), \
                mock.patch.object(d, "files", return_value=[]), \
                mock.patch("urllib.request.urlopen", return_value=Resp()), \
                mock.patch.object(d.deploy_gate, "head_sha", return_value="abc12345"), \
                mock.patch.object(d.deploy_gate, "touched_now", return_value=["next/engine/prompt_text.ts"]), \
                mock.patch.object(d.deploy_gate, "append_record") as rec, \
                mock.patch.object(d.deploy_gate, "run_staging") as run:
            self.assertEqual(d.main(["--rollback"]), 0)
            run.assert_not_called()
            self.assertTrue(rec.call_args[0][0]["rollback"])

    def test_staging_deploy_without_rollback_still_runs_the_gold_set(self):
        class Resp:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"version": 77}'
        with mock.patch.dict(os.environ, {"PRESENCE_SUPABASE_ENV": "staging"}), \
                mock.patch.object(d, "load_for_step", return_value={"SUPABASE_PROJECT_REF": "x", "SUPABASE_ACCESS_TOKEN": "t"}), \
                mock.patch.object(d, "files", return_value=[]), \
                mock.patch("urllib.request.urlopen", return_value=Resp()), \
                mock.patch.object(d.deploy_gate, "head_sha", return_value="abc12345"), \
                mock.patch.object(d.deploy_gate, "touched_now", return_value=["next/engine/prompt_text.ts"]), \
                mock.patch.object(d.deploy_gate, "append_record"), \
                mock.patch.object(d.deploy_gate, "run_staging", return_value=0) as run:
            self.assertEqual(d.main([]), 0)
            run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
