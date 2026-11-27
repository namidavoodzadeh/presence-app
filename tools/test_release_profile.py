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
            uuid = rp.install(p, os.path.join(d, "Provisioning Profiles"))
            path = os.path.join(d, "Provisioning Profiles", f"{uuid}.mobileprovision")
            with open(path, "rb") as f:
                self.assertEqual(f.read(), b"content of P7")
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
