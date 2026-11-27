#!/usr/bin/env python3
"""Unit test for tools/release-profile.py on a fixture /v1/profiles response. Run: python3 tools/test_release_profile.py"""
import base64, datetime, hashlib, importlib.util, json, os, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("release_profile", os.path.join(HERE, "release-profile.py"))
rp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rp)

with open(os.path.join(HERE, "fixtures", "release-profiles.json")) as f:
    FIXTURE = json.load(f)
NOW = datetime.datetime(2026, 11, 27, tzinfo=datetime.timezone.utc)
sha = lambda s: hashlib.sha1(s.encode()).hexdigest().upper()
A, B, UNKNOWN = sha("cert A"), sha("cert B"), sha("cert nobody has")


class PickProfile(unittest.TestCase):
    def pick(self, local):
        r = rp.pick_profile(FIXTURE, "B1", local, now=NOW)
        return (r[0]["id"], r[1]) if r else None

    def test_active_app_store_profile_for_bundle_with_local_cert_latest_expiry(self):
        # P2 invalid, P3 development, P4 other bundle, P8 expired, P1 foreign cert: all skipped; P7 outlasts P6.
        self.assertEqual(self.pick([A, B]), ("P7", A))

    def test_first_local_identity_wins(self):
        self.assertEqual(self.pick([B, A]), ("P5", B))

    def test_cert_among_several_on_profile(self):
        self.assertEqual(self.pick([B]), ("P5", B))

    def test_no_match_means_create(self):
        self.assertIsNone(self.pick([UNKNOWN]))
        self.assertIsNone(rp.pick_profile(FIXTURE, "B_NONE", [A, B], now=NOW))


class Helpers(unittest.TestCase):
    def test_parse_identities_keeps_distribution_only(self):
        out = ('  1) 6C2020B7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Distribution: Team (UK39PYVJ96)"\n'
               '  2) 1111111111111111111111111111111111111111 "Apple Development: Someone (XXXXXXXXXX)"\n'
               '  3) 7b679a95bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "iPhone Distribution: Team (UK39PYVJ96)"\n'
               '     3 valid identities found\n')
        self.assertEqual(rp.parse_identities(out), ["6C2020B7" + "A" * 32, "7B679A95" + "B" * 32])

    def test_bundle_resource_exact_match(self):
        doc = {"data": [{"id": "X", "attributes": {"identifier": "com.namidavoodzadeh.presence.widget"}},
                        {"id": "B1", "attributes": {"identifier": "com.namidavoodzadeh.presence"}}]}
        self.assertEqual(rp.find_bundle_resource(doc, "com.namidavoodzadeh.presence"), "B1")
        self.assertIsNone(rp.find_bundle_resource(doc, "com.other"))

    def test_pick_certificate_distribution_only(self):
        b64 = lambda s: base64.b64encode(s.encode()).decode()
        doc = {"data": [{"id": "DEV", "attributes": {"certificateType": "DEVELOPMENT", "certificateContent": b64("cert A")}},
                        {"id": "DIST", "attributes": {"certificateType": "DISTRIBUTION", "certificateContent": b64("cert A")}}]}
        self.assertEqual(rp.pick_certificate(doc, [UNKNOWN, A]), ("DIST", A))
        self.assertIsNone(rp.pick_certificate(doc, [B]))

    def test_der_signature_to_raw(self):
        r, s = b"\x00" + b"\x81" * 32, b"\x01" * 31  # high-bit pad on r, short s
        der = b"\x30" + bytes([4 + len(r) + len(s)]) + b"\x02" + bytes([len(r)]) + r + b"\x02" + bytes([len(s)]) + s
        self.assertEqual(rp._der_to_raw(der), b"\x81" * 32 + b"\x00" + b"\x01" * 31)

    def test_install_writes_uuid_file_private(self):
        p = FIXTURE["data"][6]
        with tempfile.TemporaryDirectory() as d:
            uuid = rp.install(p, os.path.join(d, "Provisioning Profiles"), trusted_root=d)
            path = os.path.join(d, "Provisioning Profiles", f"{uuid}.mobileprovision")
            with open(path, "rb") as f:
                self.assertEqual(f.read(), b"content of P7")
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)


class Review(unittest.TestCase):
    def test_expiry_must_be_valid_and_zoned(self):
        mk = lambda e: {"attributes": {} if e is None else {"expirationDate": e}}
        self.assertIsNone(rp._expiry(mk(None)))
        self.assertIsNone(rp._expiry(mk("not a date")))
        self.assertIsNone(rp._expiry(mk("2027-01-01T00:00:00")))  # no zone
        self.assertEqual(rp._expiry(mk("2026-11-27T05:00:00.000+08:00")),
                         datetime.datetime(2026, 11, 26, 21, tzinfo=datetime.timezone.utc))
        self.assertEqual(rp._expiry(mk("2026-11-27T00:00:00Z")), NOW)

    def test_profile_with_bad_expiry_is_skipped(self):
        doc = json.loads(json.dumps(FIXTURE))
        for p in doc["data"]:
            if p["id"] == "P7":
                del p["attributes"]["expirationDate"]
        r = rp.pick_profile(doc, "B1", [A, B], now=NOW)
        self.assertNotEqual(r[0]["id"], "P7")

    def test_requests_only_to_the_api_origin(self):
        self.assertEqual(rp._api_url("/v1/profiles"), "https://api.appstoreconnect.apple.com/v1/profiles")
        for bad in ("http://api.appstoreconnect.apple.com/v1/x", "https://evil.example/v1/x",
                    "https://api.appstoreconnect.apple.com.evil.example/v1", "https://u:p@api.appstoreconnect.apple.com/v1",
                    "https://api.appstoreconnect.apple.com:8443/v1"):
            with self.assertRaises(rp.Fail):
                rp._api_url(bad)

    def test_install_refuses_symlink_and_replaces_atomically(self):
        p = FIXTURE["data"][6]
        uuid = p["attributes"]["uuid"]
        with tempfile.TemporaryDirectory() as d:
            target = os.path.join(d, "elsewhere")
            with open(target, "wb") as f:
                f.write(b"keep me")
            os.symlink(target, os.path.join(d, f"{uuid}.mobileprovision"))
            with self.assertRaises(rp.Fail):
                rp.install(p, d, trusted_root=d)
            with open(target, "rb") as f:
                self.assertEqual(f.read(), b"keep me")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, f"{uuid}.mobileprovision")
            with open(path, "wb") as f:
                f.write(b"old")
            os.chmod(path, 0o644)
            rp.install(p, d, trusted_root=d)
            with open(path, "rb") as f:
                self.assertEqual(f.read(), b"content of P7")
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual([n for n in os.listdir(d) if n.endswith(".tmp")], [])

    def test_install_rejects_bad_content(self):
        p = json.loads(json.dumps(FIXTURE["data"][6]))
        p["attributes"]["profileContent"] = "!!not base64!!"
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(rp.Fail):
                rp.install(p, d, trusted_root=d)


class ReviewRound2(unittest.TestCase):
    def test_symlinked_parent_folder_refused(self):
        p = FIXTURE["data"][6]
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
            os.symlink(other, os.path.join(d, "Library"))
            with self.assertRaises(rp.Fail):
                rp.install(p, os.path.join(d, "Library", "Provisioning Profiles"), trusted_root=d)
            self.assertEqual(os.listdir(other), [])

    def test_folder_outside_root_refused(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as other:
            with self.assertRaises(rp.Fail):
                rp.install(FIXTURE["data"][6], other, trusted_root=d)

    def test_http_error_logs_codes_only(self):
        import io, urllib.error
        body = json.dumps({"errors": [{"code": "NOT_AUTHORIZED", "detail": "::set-output secret=abc"},
                                      {"code": "bad code\n::warning::x", "detail": "y"}]}).encode()
        err = urllib.error.HTTPError("https://api.appstoreconnect.apple.com/v1/x", 401, "no", {}, io.BytesIO(body))
        class Opener:
            def open(self, req, timeout=60):
                raise err
        old = rp._OPENER
        rp._OPENER = Opener()
        try:
            with self.assertRaises(rp.Fail) as cm:
                rp.Api("t").call("GET", "/v1/x")
        finally:
            rp._OPENER = old
        msg = str(cm.exception)
        self.assertIn("HTTP 401", msg)
        self.assertIn("NOT_AUTHORIZED", msg)
        self.assertNotIn("::", msg)
        self.assertNotIn("secret", msg)

    def test_certificates_fetched_when_relationship_is_cut_short(self):
        doc = json.loads(json.dumps(FIXTURE))
        target = next(p for p in doc["data"] if p["id"] == "P5")
        target["relationships"]["certificates"] = {"data": [], "meta": {"paging": {"total": 1, "limit": 50}}}
        calls = []
        b_cert = next(i for i in FIXTURE["included"] if i["type"] == "certificates" and rp.cert_sha1(i) == B)
        class FakeApi:
            def get_all(self, path, params):
                calls.append(path)
                return {"data": [b_cert] if path == "/v1/profiles/P5/certificates" else [], "included": []}
        rp.complete_certificates(FakeApi(), doc, "B1")
        self.assertIn("/v1/profiles/P5/certificates", calls)
        self.assertEqual(rp.pick_profile(doc, "B1", [B], now=NOW)[0]["id"], "P5")


if __name__ == "__main__":
    unittest.main()
