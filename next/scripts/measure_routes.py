#!/usr/bin/env python3
"""Read-only latency table for the routes the V3 app calls, as namitest (flagged test account). Never prints a secret
and never prints user text: only status, bytes, item counts and timings.

    python3 next/scripts/measure_routes.py            # staging
    python3 next/scripts/measure_routes.py --hosted   # production (step seed_test_contact loader)
    options: --n 12 (warm samples per route), --json out.json, --persona namitest, --parallel (also time the
             Home screen's calls fired together, as the app does), --region eu-west-1 (x-region pin), --fresh (no keep-alive)

Cold = the first request this run makes to each route (and x-presence-first-request=true marks a fresh instance).
Warm = the next n requests, one at a time. Server-timing (total/auth/guard/route) comes from the API's own header.
"""
from __future__ import annotations
import argparse, http.client, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--hosted", action="store_true"); ap.add_argument("--n", type=int, default=12)
ap.add_argument("--json"); ap.add_argument("--persona", default="namitest"); ap.add_argument("--parallel", action="store_true")
ap.add_argument("--fresh", action="store_true", help="new TCP+TLS connection per request (default: kept alive, as the app)")
ap.add_argument("--region", default="", help="pin the function to this region (x-region header), e.g. eu-west-1")
args = ap.parse_args()
if not args.hosted:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
secret_text = (home / "secrets/preview-device.env").read_text() if args.hosted else (home / "secrets/staging.env").read_text()
m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", secret_text, re.M)
SECRET = m.group(1) if m else ""


_u = urllib.parse.urlsplit(BASE)
PREFIX = _u.path
_local = threading.local()


def conn():
    if getattr(_local, "c", None) is None:
        _local.c = http.client.HTTPSConnection(_u.netloc, timeout=60)
    return _local.c


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", ""), "x-presence-tz": "America/Los_Angeles"}
    if token: h["authorization"] = "Bearer " + token
    if args.region: h["x-region"] = args.region
    if path == "/preview/login": h["x-presence-preview-secret"] = SECRET
    data = json.dumps(body).encode() if body is not None else None
    t0 = time.perf_counter()
    if args.fresh:  # a new TCP+TLS connection per request
        req = urllib.request.Request(BASE + path, method=method, headers=h, data=data)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw, status, hdr = r.read(), r.status, r.headers
        except urllib.error.HTTPError as e:
            raw, status, hdr = e.read(), e.code, e.headers
    else:  # one kept-alive connection per thread, as URLSession does
        c = conn()
        try:
            c.request(method, PREFIX + path, body=data, headers=h); r = c.getresponse(); raw, status, hdr = r.read(), r.status, r.headers
        except (http.client.HTTPException, OSError):
            _local.c = None; c = conn()
            c.request(method, PREFIX + path, body=data, headers=h); r = c.getresponse(); raw, status, hdr = r.read(), r.status, r.headers
    ms = (time.perf_counter() - t0) * 1000
    st = {k: float(v) for k, v in re.findall(r"(\w+);dur=([\d.]+)", hdr.get("server-timing", "") or "")}
    try: j = json.loads(raw or b"{}")
    except Exception: j = {}
    return {"status": status, "ms": ms, "bytes": len(raw), "st": st, "first": hdr.get("x-presence-first-request") == "true",
            "instance": hdr.get("x-presence-instance", ""), "region": hdr.get("x-sb-edge-region", ""), "json": j}


def pct(xs, p):
    xs = sorted(xs)
    if not xs: return 0.0
    k = (len(xs) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


login = call("POST", "/preview/login", {"persona": args.persona})
tok = str(login["json"].get("access_token", ""))
if not tok:
    sys.exit(f"login {args.persona} failed: {login['status']}")
other = call("POST", "/preview/login", {"persona": "jantest" if args.persona == "namitest" else "namitest"})
oid = str(((other["json"].get("me") or {}).get("person") or {}).get("id", ""))
convs = call("GET", "/conversations", token=tok)
conv_list = convs["json"].get("conversations") or []
cid = conv_list[0]["id"] if conv_list else None

ROUTES = ["/me", "/home", "/kennings", "/people", f"/people/{oid}/map", "/map", "/conversations",
          *( [f"/conversations/{cid}"] if cid else [] ), "/threads", f"/threads/{oid}", "/checkin", f"/checkin/{oid}",
          f"/checkin/{oid}/session", "/checkin/invites", f"/cards/{oid}", f"/drafts/{oid}", "/outside"]


def label(p):
    return p.replace(oid, ":person").replace(cid or "@@", ":id")


rows = []
for p in ROUTES:
    cold = call("GET", p, token=tok)
    warm = [call("GET", p, token=tok) for _ in range(args.n)]
    ok = [w for w in warm if w["status"] == 200]
    ms = [w["ms"] for w in ok]; srv = [w["st"].get("total", 0) for w in ok]
    rows.append({"route": label(p), "status": cold["status"], "bytes": cold["bytes"], "cold_ms": round(cold["ms"]),
                 "cold_first_instance": cold["first"], "cold_srv": round(cold["st"].get("total", 0)),
                 "warm_p50": round(pct(ms, 50)), "warm_p95": round(pct(ms, 95)), "srv_p50": round(pct(srv, 50)),
                 "srv_p95": round(pct(srv, 95)), "auth_p50": round(pct([w["st"].get("auth", 0) for w in ok], 50)),
                 "guard_p50": round(pct([w["st"].get("guard", 0) for w in ok], 50)),
                 "route_p50": round(pct([w["st"].get("route", 0) for w in ok], 50)),
                 "instances": len({w["instance"] for w in warm}), "edge_region": cold["region"], "errors": len(warm) - len(ok)})
    r = rows[-1]
    print(f"{r['route']:<28} {r['status']} {r['bytes']:>7}B cold {r['cold_ms']:>5} (srv {r['cold_srv']:>5}{' NEW' if r['cold_first_instance'] else ''})"
          f"  warm p50 {r['warm_p50']:>5} p95 {r['warm_p95']:>5}  srv p50 {r['srv_p50']:>5} p95 {r['srv_p95']:>5}"
          f"  auth {r['auth_p50']:>4} guard {r['guard_p50']:>4} route {r['route_p50']:>5}  err {r['errors']}", flush=True)

par = None
if args.parallel:
    screen = ["/me", "/home", "/kennings", "/people", "/threads", "/checkin", "/conversations"]
    walls = []
    with ThreadPoolExecutor(len(screen)) as ex:  # the same threads (and their kept-alive connections) every round
        list(ex.map(lambda p: call("GET", p, token=tok), screen))  # warm-up round, not counted
        for _ in range(max(3, args.n // 3)):
            t0 = time.perf_counter()
            list(ex.map(lambda p: call("GET", p, token=tok), screen))
            walls.append((time.perf_counter() - t0) * 1000)
    par = {"routes": screen, "p50": round(pct(walls, 50)), "p95": round(pct(walls, 95))}
    print(f"parallel {len(screen)} calls: wall p50 {par['p50']} p95 {par['p95']}")

base_rtt = [call("GET", "/health")["ms"] for _ in range(args.n)]
print(f"/health (no auth, no db) p50 {round(pct(base_rtt, 50))} p95 {round(pct(base_rtt, 95))}")
if args.json:
    Path(args.json).write_text(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "hosted": args.hosted,
                                           "persona": args.persona, "n": args.n, "fresh": args.fresh, "region": args.region or "default", "rows": rows, "parallel": par,
                                           "health_p50": round(pct(base_rtt, 50)), "health_p95": round(pct(base_rtt, 95))}, indent=1))
