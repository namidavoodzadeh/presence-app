#!/usr/bin/env python3
"""Install the App Store provisioning profile for a release export, through the App Store Connect API.

Uses the API key in ASC_KEY_PATH / ASC_KEY_ID / ASC_ISSUER_ID. Finds the bundle ID resource, then picks the
ACTIVE IOS_APP_STORE profile for it whose certificates include an Apple Distribution identity present in the
given keychain. Creates one only if none matches. Writes it to <profiles-dir>/<uuid>.mobileprovision.

Prints two lines for $GITHUB_OUTPUT and nothing else on stdout:
  uuid=<profile uuid>
  sha1=<signing identity SHA-1>
Never prints the key, the token or profile contents. Stdlib only; signs the token with the system openssl.

Usage: release-profile.py --bundle-id ID --keychain PATH [--profiles-dir DIR]"""
import argparse, base64, datetime, hashlib, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API = "https://api.appstoreconnect.apple.com"
PROFILE_TYPE = "IOS_APP_STORE"
DIST_CERT_TYPES = {"DISTRIBUTION", "IOS_DISTRIBUTION"}
DEFAULT_PROFILES_DIR = os.path.expanduser("~/Library/Developer/Xcode/UserData/Provisioning Profiles")


class Fail(Exception):
    pass


# ---------- pure logic (unit tested on a fixture) ----------

def cert_sha1(cert):
    """Upper-case hex SHA-1 of a certificates resource's DER content, as `security find-identity` prints it."""
    content = (cert.get("attributes") or {}).get("certificateContent")
    if not content:
        return None
    return hashlib.sha1(base64.b64decode(content)).hexdigest().upper()


def parse_identities(find_identity_output):
    """SHA-1s of distribution signing identities from `security find-identity -v -p codesigning` output."""
    out = []
    for line in find_identity_output.splitlines():
        m = re.match(r'^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(.+)"', line)
        if m and re.match(r"(Apple|iPhone) Distribution", m.group(2)):
            sha = m.group(1).upper()
            if sha not in out:
                out.append(sha)
    return out


def find_bundle_resource(doc, identifier):
    """The bundleIds resource id whose identifier matches exactly (the API filter is not exact)."""
    for b in doc.get("data", []):
        if (b.get("attributes") or {}).get("identifier") == identifier:
            return b["id"]
    return None


def _expiry(profile):
    """The profile's expiration as an aware UTC datetime, or None when it is missing, malformed or has no zone."""
    exp = (profile.get("attributes") or {}).get("expirationDate")
    if not isinstance(exp, str) or not exp:
        return None
    try:
        when = datetime.datetime.fromisoformat(exp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None or when.utcoffset() is None:
        return None
    return when.astimezone(datetime.timezone.utc)


def pick_profile(doc, bundle_resource_id, local_sha1s, now=None):
    """From a /v1/profiles response with include=bundleId,certificates, pick (profile, sha1).

    The profile must be ACTIVE, IOS_APP_STORE, for the bundle resource, with a valid zoned expiry in the future,
    and a certificate whose
    SHA-1 is a local identity. Prefers the earliest local identity, then the latest expiry. None if no match."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    certs = {}
    for inc in doc.get("included", []):
        if inc.get("type") == "certificates":
            certs[inc["id"]] = cert_sha1(inc)
    found = []
    for p in doc.get("data", []):
        a = p.get("attributes") or {}
        rel = p.get("relationships") or {}
        if a.get("profileType") != PROFILE_TYPE or a.get("profileState") != "ACTIVE":
            continue
        if ((rel.get("bundleId") or {}).get("data") or {}).get("id") != bundle_resource_id:
            continue
        when = _expiry(p)
        if not a.get("uuid") or not a.get("profileContent") or when is None or when <= now:
            continue
        shas = {certs.get(c["id"]) for c in ((rel.get("certificates") or {}).get("data") or [])}
        for rank, sha in enumerate(local_sha1s):
            if sha in shas:
                found.append((rank, when, p, sha))
                break
    if not found:
        return None
    top = min(f[0] for f in found)
    _, _, p, sha = max((f for f in found if f[0] == top), key=lambda f: f[1])
    return p, sha


def pick_certificate(doc, local_sha1s):
    """From a /v1/certificates response, the (certificate id, sha1) of the first local distribution identity."""
    by_sha = {}
    for c in doc.get("data", []):
        if (c.get("attributes") or {}).get("certificateType") in DIST_CERT_TYPES:
            sha = cert_sha1(c)
            if sha:
                by_sha.setdefault(sha, c["id"])
    for sha in local_sha1s:
        if sha in by_sha:
            return by_sha[sha], sha
    return None


# ---------- App Store Connect API ----------

def _b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _der_to_raw(der):
    """ECDSA DER signature (SEQUENCE of two INTEGERs) to the 64-byte r||s form JWS needs."""
    def read_len(i):
        n = der[i]
        if n < 0x80:
            return n, i + 1
        k = n & 0x7F
        return int.from_bytes(der[i + 1:i + 1 + k], "big"), i + 1 + k
    if der[0] != 0x30:
        raise Fail("unexpected signature format from openssl")
    _, i = read_len(1)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            raise Fail("unexpected signature format from openssl")
        n, i = read_len(i + 1)
        parts.append(int.from_bytes(der[i:i + n], "big").to_bytes(32, "big"))
        i += n
    return b"".join(parts)


def make_token(key_path, key_id, issuer):
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode())
    claims = _b64url(json.dumps({"iss": issuer, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"}).encode())
    signing_input = f"{header}.{claims}".encode()
    r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path], input=signing_input,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0 or not r.stdout:
        raise Fail("could not sign the App Store Connect token with the key at ASC_KEY_PATH")
    return f"{header}.{claims}.{_b64url(_der_to_raw(r.stdout))}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: the Authorization header must not reach any other address."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Fail(f"App Store Connect answered with a redirect (HTTP {code}); not followed")


_OPENER = urllib.request.build_opener(_NoRedirect)


def _api_url(url):
    """Absolute https URL on the App Store Connect origin only; anything else is refused before a request is made."""
    if url.startswith("/"):
        url = API + url
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.hostname != "api.appstoreconnect.apple.com" or u.port not in (None, 443) or u.username or u.password:
        raise Fail("refused a request outside https://api.appstoreconnect.apple.com")
    return url


class Api:
    def __init__(self, token):
        self.token = token

    def call(self, method, url, body=None):
        url = _api_url(url)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with _OPENER.open(req, timeout=60) as resp:
                return json.loads(resp.read() or b"{}")
        except urllib.error.HTTPError as e:
            # Report only the error details, never a response body that could hold profile content.
            try:
                errs = json.loads(e.read()).get("errors", [])
                detail = "; ".join(f"{x.get('code')}: {x.get('detail')}" for x in errs)
            except Exception:
                detail = ""
            path = urllib.parse.urlparse(url).path
            raise Fail(f"App Store Connect {method} {path} returned HTTP {e.code} {detail}".strip())
        except urllib.error.URLError as e:
            raise Fail(f"App Store Connect unreachable: {e.reason}")

    def get_all(self, path, params):
        """GET with pagination; merges data and included across pages."""
        url = f"{path}?{urllib.parse.urlencode(params)}"
        merged = {"data": [], "included": []}
        seen = set()
        while url:
            doc = self.call("GET", url)
            merged["data"].extend(doc.get("data", []))
            for inc in doc.get("included", []):
                k = (inc.get("type"), inc.get("id"))
                if k not in seen:
                    seen.add(k)
                    merged["included"].append(inc)
            url = (doc.get("links") or {}).get("next")
        return merged


def local_identities(keychain):
    r = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning", keychain],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise Fail(f"security find-identity failed on {keychain}")
    return parse_identities(r.stdout)


def install(profile, profiles_dir):
    """Decode and check the profile first, then write it atomically as <uuid>.mobileprovision, mode 0600.
    Refuses a symlinked profiles folder or target; never truncates an existing file before the new one is ready."""
    a = profile["attributes"]
    uuid = a["uuid"]
    if not re.fullmatch(r"[0-9A-Fa-f-]{36}", uuid):
        raise Fail("profile uuid has an unexpected form")
    try:
        content = base64.b64decode(a.get("profileContent") or "", validate=True)
    except (ValueError, TypeError):
        raise Fail("profile content is not valid base64")
    if not content or len(content) > 1_000_000:
        raise Fail("profile content is empty or too large")
    os.makedirs(profiles_dir, exist_ok=True)
    if os.path.islink(profiles_dir.rstrip(os.sep)):
        raise Fail("the profiles folder is a symlink; refusing to write")
    path = os.path.join(profiles_dir, f"{uuid}.mobileprovision")
    if os.path.islink(path):
        raise Fail("the profile path is a symlink; refusing to write")
    tmp = os.path.join(profiles_dir, f".{uuid}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
    return uuid


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bundle-id", required=True)
    ap.add_argument("--keychain", required=True)
    ap.add_argument("--profiles-dir", default=DEFAULT_PROFILES_DIR)
    args = ap.parse_args(argv)
    env = {k: os.environ.get(k, "") for k in ("ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID")}
    if not all(env.values()):
        raise Fail("set ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID")

    local = local_identities(args.keychain)
    if not local:
        raise Fail(f"no Apple Distribution identity in {args.keychain}")
    log(f"local distribution identities: {', '.join(s[:8] + '…' for s in local)}")

    api = Api(make_token(env["ASC_KEY_PATH"], env["ASC_KEY_ID"], env["ASC_ISSUER_ID"]))
    bundles = api.get_all("/v1/bundleIds", {"filter[identifier]": args.bundle_id, "limit": 200})
    bundle_res = find_bundle_resource(bundles, args.bundle_id)
    if not bundle_res:
        raise Fail(f"bundle ID {args.bundle_id} is not registered in App Store Connect")

    profiles = api.get_all("/v1/profiles", {
        "filter[profileType]": PROFILE_TYPE, "include": "bundleId,certificates",
        "limit": 200, "limit[certificates]": 50})
    picked = pick_profile(profiles, bundle_res, local)
    if picked:
        profile, sha = picked
        log(f"using existing profile {profile['attributes'].get('name')!r} for identity {sha[:8]}…")
    else:
        certs = api.get_all("/v1/certificates", {"limit": 200})
        cert = pick_certificate(certs, local)
        if not cert:
            raise Fail("no App Store Connect distribution certificate matches a local identity")
        cert_id, sha = cert
        name = f"Presence CI App Store {time.strftime('%Y%m%d%H%M%S', time.gmtime())}"
        log(f"no matching profile; creating {name!r} for identity {sha[:8]}…")
        created = api.call("POST", "/v1/profiles", {"data": {
            "type": "profiles",
            "attributes": {"name": name, "profileType": PROFILE_TYPE},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle_res}},
                "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})
        profile = created.get("data") or {}
        if not (profile.get("attributes") or {}).get("profileContent"):
            raise Fail("created profile came back without content")

    uuid = install(profile, args.profiles_dir)
    log(f"installed profile {uuid}")
    print(f"uuid={uuid}")
    print(f"sha1={sha}")
    return 0


def log(msg):
    print(f"release-profile: {msg}", file=sys.stderr)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Fail as e:
        print(f"::error::release-profile: {e}", file=sys.stderr)
        sys.exit(1)
