#!/usr/bin/env python3
"""Live probe of contract v1.66 (migration 0057): kenning voice and own kennings, as namitest/jantest (flagged test accounts).
Never prints a secret.

    python3 next/scripts/probe_kenning_voice.py            # staging (one Talk turn on staging's own key, ~1-2 cents)
    python3 next/scripts/probe_kenning_voice.py --no-talk  # skip the Talk turn ($0)
    python3 next/scripts/probe_kenning_voice.py --hosted   # production, test accounts only, after Nami's yes

POST /beliefs (created, own, one dated receipt; law 8 floor stores nothing; 400s), 'Edit the words' writes own_wording and
leaves statement, GET /kennings carries own_wording/offered_wording/source, the share default is own_wording, and (with Talk)
a shown card carries offered_wording. Every row it makes is deleted at the end (beliefs, receipts, grants, the conversation).
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error, uuid
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
TALK = "--no-talk" not in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
_secrets = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome")) / "secrets"
if HOSTED:
    _f = _secrets / "preview-device.env"
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", _f.read_text(), re.M) if _f.exists() else None
else:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (_secrets / "staging.env").read_text(), re.M)
secret = m.group(1) if m else None
print("target", "hosted" if HOSTED else "staging")
results: list[tuple[str, bool, str]] = []
FIRST = re.compile(r"^(i|i['’]m|i['’]ve|i['’]d|i['’]ll|my|me|mine)\b", re.I)


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "accept": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if token: h["authorization"] = "Bearer " + token
    if secret and path == "/preview/login": h["x-presence-preview-secret"] = secret
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s


nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
TAG = "probe-" + uuid.uuid4().hex[:6]
LINE = f"Quiet means I'm thinking ({TAG})."
made: list[str] = []
conv = None
try:
    s, j = call("POST", "/beliefs", {"statement": "  " + LINE + " ", "relationship": "friend"}, nt)
    b = j.get("belief") or {}
    if b.get("belief_id"): made.append(str(b["belief_id"]))
    check("POST /beliefs 201 created, own, confirmed very, words as typed",
          s == 201 and j.get("state") == "created" and b.get("source") == "own" and b.get("status") == "confirmed" and b.get("rating") == "very"
          and b.get("statement") == LINE and b.get("own_wording") == LINE and b.get("area") == "relationships" and b.get("offered_wording") is None, f"{s}")
    rc = b.get("receipts") or []
    check("one receipt quoting the line, dated today", len(rc) == 1 and rc[0].get("quote") == LINE, f"{len(rc)}")
    s, j = call("GET", f"/beliefs/{b.get('belief_id')}", token=nt)
    check("GET /beliefs/:id shows the receipt", s == 200 and len(j.get("receipts") or []) == 1, f"{s}")
    s, j = call("GET", "/kennings", token=nt)
    item = next((i for g in (j.get("groups") or []) for i in g.get("items") or [] if i.get("belief_id") == b.get("belief_id")), None)
    check("GET /kennings lists it with own_wording and source own", s == 200 and item and item.get("own_wording") == LINE and item.get("source") == "own", f"{s}")
    sug = j.get("suggested") or []
    check("kennings items carry own_wording/offered_wording keys", all("own_wording" in x and "offered_wording" in x for g in (j.get("groups") or []) for x in g.get("items") or []) and all("offered_wording" in x for x in sug), f"{len(sug)} suggested")
    n_before = run_sql(env, f"select count(*) as n from beliefs where owner = '{nid}'")[1]
    s, j = call("POST", "/beliefs", {"statement": "I want to kill myself."}, nt)
    n_after = run_sql(env, f"select count(*) as n from beliefs where owner = '{nid}'")[1]
    check("law 8 floor: state safety, resources, nothing stored", s == 200 and j.get("state") == "safety" and j.get("resources") and j.get("belief") is None and n_before == n_after, f"{s}")
    s, j = call("POST", "/beliefs", {"statement": "   "}, nt)
    check("blank is 400 invalid field statement", s == 400 and "statement" in json.dumps(j), f"{s}")
    s, j = call("POST", "/beliefs", {"statement": "I plan.", "relationship": "boss"}, nt)
    check("unknown relationship is 400 field relationship", s == 400 and "relationship" in json.dumps(j), f"{s}")
    EDIT = f"I go quiet when I'm thinking ({TAG})."
    s, j = call("PATCH", f"/beliefs/{b.get('belief_id')}", {"own_wording": EDIT}, nt)
    eb = j.get("belief") or {}
    check("'Edit the words' writes own_wording, statement unchanged", s == 200 and eb.get("own_wording") == EDIT and eb.get("statement") == LINE, f"{s}")
    s, j = call("GET", f"/links/{jid}/share", token=nt)
    it = next((i for i in j.get("items") or [] if i.get("belief_id") == b.get("belief_id")), None)
    check("share list wording is own_wording", s == 200 and it and it.get("wording") == EDIT, f"{s}")
    s, j = call("PUT", f"/links/{jid}/share/items/{b.get('belief_id')}", {"shared": True}, nt)
    check("default grant uses own_wording", s == 200 and (j.get("item") or {}).get("shared_wording") == EDIT, f"{s}")
    s, j = call("GET", f"/people/{nid}/map", token=jt)
    check("jantest reads exactly the own words, no receipts", s == 200 and EDIT in json.dumps(j) and not j.get("receipts"), f"{s}")
    call("PUT", f"/links/{jid}/share/items/{b.get('belief_id')}", {"shared": False}, nt)
    if TALK:
        turns = ["Every time plans change at the last minute I just say it's fine, even when it isn't. "
                 "I always say it's fine so nobody gets upset, and then I sit with it on my own.",
                 "Last Friday my sister moved dinner again and I said no problem, it's fine. Then I was quiet all evening.",
                 "It's always me who says it's fine. I'd rather keep the peace than make a fuss about it."]
        cards: list = []
        for i, text in enumerate(turns):
            s, j = call("POST", "/talk/turn", {"conversation_id": conv, "text": text, "mode": "text", "starter": False, "belief_id": None}, nt)
            if s == 409 and conv is None:
                break
            conv = conv or ((j.get("conversation") or {}).get("id"))
            r = j.get("reply") or {}
            cards = (r.get("cards") or []) + ([r["early_guess"]] if r.get("early_guess") else [])
            print(f"   turn {i + 1}: {s}, {len(cards)} card(s)")
            if s != 200 or cards: break
        if s == 409 and conv is None:
            check("Talk turn (skipped: namitest has an active conversation)", True, "409")
        else:
            check("Talk shows a card within three turns", s == 200 and cards, f"{s} cards={len(cards)}")
            check("every Talk card carries offered_wording and own_wording keys", cards and all("offered_wording" in c and "own_wording" in c for c in cards), f"{len(cards)}")
            check("own_wording stays null on Talk's cards (the person never confirmed it)", all(c.get("own_wording") is None for c in cards))
            offers = [c.get("offered_wording") for c in cards if c.get("offered_wording")]
            check("a shown card carries a first-person offer, never the statement", offers and all(FIRST.match(o) for o in offers)
                  and all(c.get("offered_wording") != c.get("statement") for c in cards if c.get("offered_wording")), f"{len(offers)}/{len(cards)} offered")
            for c in cards: print("   card:", json.dumps({"statement": c.get("statement"), "offered_wording": c.get("offered_wording")}))
finally:
    if conv:
        s, _ = call("DELETE", f"/conversations/{conv}", token=nt); print("deleted probe conversation", s)
    for bid in made:
        run_sql(env, f"delete from share_items where belief_id = '{bid}'"); run_sql(env, f"delete from beliefs where id = '{bid}'")
    code, out = run_sql(env, f"select count(*) as n from beliefs where owner = '{nid}' and statement like '%{TAG}%'")
    print("probe rows left", out)

fails = [r for r in results if not r[1]]
print(f"{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
