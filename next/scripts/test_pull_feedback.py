"""pull_feedback reads production through the no-echo loader and marks pulled only what it copied. Fake env, fake SQL."""
import contextlib, io, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import pull_feedback as pf  # noqa: E402

PROD_SVC, STG_SVC = "prod-service-SECRETVALUE-111", "stg-service-SECRETVALUE-222"


def write(root, name, svc):
    d = root / "secrets"; d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text("\n".join([f"SUPABASE_URL=https://{name}.example.co", "SUPABASE_PROJECT_REF=ref", "SUPABASE_ANON_KEY=anon",
                                     f"SUPABASE_SERVICE_ROLE_KEY={svc}", "SUPABASE_ACCESS_TOKEN=tok"]) + "\n")


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        write(self.root, "supabase.env", PROD_SVC); write(self.root, "staging.env", STG_SVC)
        self.saved = dict(os.environ)
        os.environ.pop("PRESENCE_SUPABASE_ENV", None)
        os.environ["PRESENCE_HOME_ROOT"] = str(self.root)
        self.rows = [{"id": "a", "report_id": "r-1", "reporter": "x", "body": "b", "screenshot_path": "p1", "created_at": "t"},
                     {"id": "b", "report_id": "r-2", "reporter": "x", "body": "b", "screenshot_path": "p2", "created_at": "t"}]
        self.sql, self.keys = [], []
        self.out = self.root / "out"
        pf.ROOT = self.root

    def tearDown(self):
        os.environ.clear(); os.environ.update(self.saved); self.tmp.cleanup()

    def run_sql(self, env, sql):
        self.keys.append(env["SUPABASE_SERVICE_ROLE_KEY"]); self.sql.append(sql)
        return (201, json.dumps(self.rows)) if sql.startswith("select") else (201, "[]")

    def download(self, env, path):
        if path == "p2": raise pf.Failed("download failed")
        if path == "p3": raise pf.Missing(path)
        return b"jpeg"

    def go(self, argv):
        buf = io.StringIO()
        with mock.patch.object(pf, "run_sql", self.run_sql), mock.patch.object(pf, "download", self.download), contextlib.redirect_stdout(buf):
            try: rc = pf.main(argv)
            except SystemExit as e: rc = str(e.code)
        return rc, buf.getvalue()

    def test_reads_production_keys_and_never_prints_them(self):
        rc, out = self.go(["--dry-run"])
        self.assertEqual(rc, 0); self.assertEqual(set(self.keys), {PROD_SVC})
        self.assertNotIn(PROD_SVC, out)

    def test_staging_flag_uses_staging(self):
        os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
        self.go(["--dry-run"]); self.assertEqual(set(self.keys), {STG_SVC})

    def test_marks_only_what_it_copied(self):
        rc, _ = self.go([])
        self.assertNotEqual(rc, 0)  # r-2 download failed
        updates = [s for s in self.sql if s.startswith("update")]
        self.assertEqual(len(updates), 1); self.assertIn("'a'", updates[0]); self.assertNotIn("'b'", updates[0])

    def test_a_failing_report_does_not_block_the_ones_behind_it(self):
        self.rows = [self.rows[1], dict(self.rows[0], id="c", report_id="r-3")]   # r-2 fails first, r-3 follows
        rc, _ = self.go([])
        self.assertNotEqual(rc, 0)
        updates = [s for s in self.sql if s.startswith("update")]
        self.assertEqual(len(updates), 1); self.assertIn("'c'", updates[0])
        self.assertTrue((self.root / "outputs/qa/inbox").glob("*/r-3.json").__next__().exists())
        self.assertFalse(list((self.root / "outputs/qa/inbox").glob("*/r-2.*")))   # nothing half written for the failed one

    def test_a_failed_mark_keeps_the_copy_and_retries(self):
        rows = [self.rows[0]]; self.rows = rows
        def run_sql(env, sql):
            return (500, "boom") if sql.startswith("update") else (201, json.dumps(rows))
        buf = io.StringIO()
        with mock.patch.object(pf, "run_sql", run_sql), mock.patch.object(pf, "download", self.download), contextlib.redirect_stdout(buf):
            rc = pf.main([])
        self.assertEqual(rc, 1)
        self.assertTrue(list((self.root / "outputs/qa/inbox").glob("*/r-1.json")))

    def test_missing_screenshot_keeps_the_words_and_marks_pulled(self):
        self.rows = [dict(self.rows[0], report_id="r-9", screenshot_path="p3")]
        rc, _ = self.go([])
        self.assertEqual(rc, 0)
        f = next((self.root / "outputs/qa/inbox").glob("*/r-9.json"))
        self.assertTrue(json.loads(f.read_text())["screenshot_missing"])
        self.assertEqual(len([s for s in self.sql if s.startswith("update")]), 1)

    def test_report_without_screenshot_pulls_words_and_is_not_marked_missing(self):
        self.rows = [dict(self.rows[0], report_id="r-n0", screenshot_path=None)]
        rc, _ = self.go([])
        self.assertEqual(rc, 0)
        inbox = self.root / "outputs/qa/inbox"
        meta = json.loads(next(inbox.glob("*/r-n0.json")).read_text())
        self.assertNotIn("screenshot_missing", meta)
        self.assertEqual(list(inbox.glob("*/r-n0.jpg")), [])
        self.assertEqual(len([s for s in self.sql if s.startswith("update")]), 1)

    def test_event_line_per_report_with_reporter_kind(self):
        (self.root / "outputs/control").mkdir(parents=True)
        (self.root / "outputs/control/feedback-owner-ids.txt").write_text("# owner\nowner-uuid\n")
        self.rows = [dict(self.rows[0], report_id="r-o", reporter="owner-uuid"),
                     dict(self.rows[0], id="f", report_id="r-f", reporter="friend-uuid"),
                     dict(self.rows[0], id="t", report_id="r-t", reporter="jan-uuid", account_kind="test"),
                     dict(self.rows[0], id="n", report_id="r-n", reporter=None)]
        rc, _ = self.go([])
        self.assertEqual(rc, 0)
        ev = [json.loads(l) for l in (self.root / "outputs/control/tester-feedback-events.jsonl").read_text().splitlines()]
        self.assertEqual({e["report_id"]: e["reporter_kind"] for e in ev}, {"r-o": "owner", "r-f": "friend", "r-t": "test", "r-n": "test"})

    def test_friend_report_with_new_fields_pulls_with_and_without_screenshot(self):
        body = {"build_kind": "friend", "screen": "home", "appearance": "dark", "text_size": "xl", "network": "wifi",
                "screen_trail": ["home", "person"], "error_refs": ["5JKP"], "screenshot_left_out": False, "note": "words"}
        self.rows = [dict(self.rows[0], report_id="r-w", reporter="friend-uuid", body=body, screenshot_path="p1"),
                     dict(self.rows[0], id="z", report_id="r-x", reporter="friend-uuid",
                          body=dict(body, screenshot_left_out=True), screenshot_path="p3")]
        rc, _ = self.go([])
        self.assertEqual(rc, 0)
        inbox = self.root / "outputs/qa/inbox"
        for rid in ("r-w", "r-x"):
            meta = json.loads(next(inbox.glob(f"*/{rid}.json")).read_text())
            self.assertEqual(meta["reporter_kind"], "friend")
            self.assertEqual(meta["body"]["screen_trail"], ["home", "person"])
            self.assertEqual(meta["body"]["error_refs"], ["5JKP"])
        self.assertTrue(next(inbox.glob("*/r-w.jpg")).exists())
        self.assertEqual(list(inbox.glob("*/r-x.jpg")), [])
        ev = [json.loads(l) for l in (self.root / "outputs/control/tester-feedback-events.jsonl").read_text().splitlines()]
        self.assertEqual({e["build_kind"] for e in ev}, {"friend"})

    def test_dry_run_marks_nothing(self):
        self.go(["--dry-run"]); self.assertFalse([s for s in self.sql if s.startswith("update")])

    def test_mark_existing_marks_only_rows_with_a_copied_file(self):
        d = self.root / "inbox"; d.mkdir(); (d / "r-1.json").write_text("{}")
        rc, out = self.go(["--mark-existing", str(d)])
        self.assertEqual(rc, 0)
        updates = [s for s in self.sql if s.startswith("update")]
        self.assertEqual(len(updates), 1); self.assertIn("'a'", updates[0]); self.assertIn("marked 1", out)

    def test_pull_appends_one_hq_row_without_words_and_never_twice(self):
        self.rows = [{"id": "a", "report_id": "r-1", "reporter": "x", "screenshot_path": None, "created_at": "2026-11-16 04:40:33+00",
                      "body": {"note": "SECRET WORDS", "log": ["GET x"], "screen": "v3.home", "source": "report-button",
                               "build": "0.9 (1) TestFlight", "facts": {"build_kind": "owner", "screenshot": "not sent"}}}]
        with mock.patch.object(pf, "run_sql", self.run_sql), mock.patch.object(pf, "download", self.download):
            self.go([]); self.go([])
        f = self.root / "outputs/control/hq-reports.jsonl"
        lines = f.read_text().splitlines()
        self.assertEqual(len(lines), 1)
        row = json.loads(lines[0])
        self.assertEqual((row["report_id"], row["screen"], row["build_kind"], row["source"]), ("r-1", "v3.home", "owner", "report-button"))
        self.assertNotIn("SECRET", lines[0]); self.assertNotIn("GET x", lines[0]); self.assertNotIn("screenshot", lines[0])

    def test_backfill_hq_rebuilds_from_inbox_files_once(self):
        day = self.root / "inbox" / "2026-11-15"; day.mkdir(parents=True)
        (day / "r-9.json").write_text(json.dumps({"report_id": "r-9", "reporter_kind": "friend", "created_at": "t9",
                                                  "body": {"note": "PRIVATE", "screen": "v3.you", "facts": {"build_kind": "friend"}}}))
        (day / "bad.json").write_text("not json")
        out = self.root / "hq.jsonl"
        self.assertEqual(pf.backfill_hq(self.root / "inbox", out), 1)
        self.assertEqual(pf.backfill_hq(self.root / "inbox", out), 0)
        row = json.loads(out.read_text())
        self.assertEqual((row["reporter_kind"], row["build_kind"], row["screen"]), ("friend", "friend", "v3.you"))
        self.assertNotIn("PRIVATE", out.read_text())

    def test_backfill_flag_never_reaches_the_loader(self):
        with mock.patch.object(pf, "load_for_step", side_effect=AssertionError("loader touched")), \
             mock.patch.object(pf, "backfill_hq", return_value=3) as backfill, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(pf.main(["--backfill-hq"]), 0)
        backfill.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
