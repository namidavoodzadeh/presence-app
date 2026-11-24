#!/usr/bin/env python3
"""Live probe of kenning map v2 (contract v1.75, migration 0064) as namitest/jantest (flagged test accounts).
Never prints a secret. Seeds three fictional confirmed kennings with fictional receipts; every row it makes is deleted at the end.

    python3 next/scripts/probe_kenning_map_v2.py            # staging
    python3 next/scripts/probe_kenning_map_v2.py --hosted   # production (only under the map pre-approval with QA PASS)

Checks: map_version 2 and lines; keyword made vs label; memberships home + said with the naming receipt id; a shared keyword
folds two kennings into one group; the person's own line choice stands alone; v1.77: cited receipts with the person's words, PSY's line rules;
v1.80/1.82: a kept-off station and its receipt stay on the owner's read, never a Seen-by or jantest read.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error, uuid
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HOSTED = "--hosted" in sys.argv
if not HOSTED:
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
from supabase_api import run_sql  # noqa: E402
from supabase_env import load_for_step  # noqa: E402

env = load_for_step("seed_test_contact")
BASE = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"
home = Path(os.environ.get("PRESENCE_HOME_ROOT", Path.home() / "Library/Application Support/PresenceHome"))
secret = None
if not HOSTED:
    m = re.search(r"^PRESENCE_PREVIEW_DEVICE_SECRET=(\S+)", (home / "secrets/staging.env").read_text(), re.M)
    secret = m.group(1) if m else None
elif (home / "secrets/preview-device.env").exists():
    m = re.search(r"^(?:export\s+)?PRESENCE_PREVIEW_DEVICE_SECRET=[\"']?([^\"'\s]+)", (home / "secrets/preview-device.env").read_text(), re.M)
    secret = m.group(1) if m else None
results: list[tuple[str, bool]] = []


def call(method, path, body=None, token=None):
    h = {"content-type": "application/json", "apikey": env.get("SUPABASE_ANON_KEY", "")}
    if token: h["authorization"] = "Bearer " + token
    if secret and path == "/preview/login": h["x-presence-preview-secret"] = secret
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}


def check(name, ok, detail=""):
    results.append((name, bool(ok))); print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def login(p):
    s, j = call("POST", "/preview/login", {"persona": p})
    return str(j.get("access_token", "")), str(((j.get("me") or {}).get("person") or {}).get("id", "")), s


def station_ids(j):
    return {s.get("belief_id") for s in j.get("stations", [])}


nt, nid, s1 = login("namitest"); jt, jid, s2 = login("jantest")
check("login namitest/jantest", nt and jt and nid and jid, f"{s1}/{s2}")
if not (nt and jt): sys.exit(1)
a, b, c, d, e, f, g, h, dot = (str(uuid.uuid4()) for _ in range(9))
ra, rb, re_, rg, rh, rm1, rm2, rd = (str(uuid.uuid4()) for _ in range(8))
QA_ = "at work and with my mum I say it is fine (probe v2)"
# Pick an already linked fictional test account for the Seen-by projection. The fresh `g` row below is the only row this probe shares.
link_code, link_out = run_sql(env, f"select case when l.person_a = '{nid}' then l.person_b else l.person_a end as id from links l join profiles p on p.id = case when l.person_a = '{nid}' then l.person_b else l.person_a end where l.status = 'active' and '{nid}' in (l.person_a, l.person_b) and p.account_kind = 'test' limit 1")
try:
    seen_by = str((json.loads(link_out) or [{}])[0].get("id", "")) if link_code in (200, 201) else ""
except (IndexError, TypeError, ValueError):
    seen_by = ""
code, out = run_sql(env, "insert into beliefs (id, owner, label, statement, type, kind, level, area, domains, status, rating, confirmed_at, rated_at, map_keyword, map_lines) values "
                    f"('{a}', '{nid}', 'Say it is fine', 'Part of you says it is fine to keep things calm.', 'a rule I live by', 'rule', 'L1', 'work', '{{work}}', 'confirmed', 'very', now(), now(), 'Fine', null), "
                    f"('{b}', '{nid}', 'Keep the peace', 'You keep the peace at dinner.', 'a rule I live by', 'rule', 'L1', 'family', '{{family}}', 'confirmed', 'very', now(), now(), null, null), "
                    f"('{c}', '{nid}', 'Fine again', 'Part of you says fine when it is not.', 'how I tend to react', 'everyday', 'L4', 'work', '{{work}}', 'confirmed', 'partly', now(), now(), 'fine', null), "
                    f"('{d}', '{nid}', 'Counted', 'You like being counted on.', 'a view or taste', 'everyday', 'L3', 'money', '{{money}}', 'confirmed', 'very', now(), now(), null, '{{me}}'), "
                    # v1.76 (CPO KM2-W4): a word stored under older rules that is now a verdict never shows; no passing word = null.
                    f"('{e}', '{nid}', 'Rest has to be earned', 'Part of you feels rest has to be earned.', 'a rule I live by', 'rule', 'L1', 'work', '{{work}}', 'confirmed', 'very', now(), now(), 'Lazy', null), "
                    f"('{f}', '{nid}', 'Not me', 'Shame and guilt.', 'how I tend to react', 'everyday', 'L4', 'meaning', '{{meaning}}', 'confirmed', 'very', now(), now(), null, null), "
                    # v1.77 (PSY 15 Nov): a harsh statement about the self gets no second line from the engine.
                    # QA-B368: a dot stored as the keyword (and a label with no content word) must come back null/none, never the dot.
                    f"('{dot}', '{nid}', 'It is not', 'Part of you is not it.', 'how I tend to react', 'everyday', 'L4', 'meaning', '{{meaning}}', 'confirmed', 'very', now(), now(), '·', null), "
                    f"('{h}', '{nid}', 'Enough', 'Part of you feels you are not enough.', 'something I believe is true', 'everyday', 'L0', 'meaning', '{{meaning}}', 'confirmed', 'very', now(), now(), null, null); "
                    # v1.77: a kenning kept off the map; its receipt never leaves.
                    f"insert into beliefs (id, owner, label, statement, type, kind, level, area, domains, status, rating, confirmed_at, rated_at, hidden_from_map) values "
                    f"('{g}', '{nid}', 'Kept off', 'You keep this one off the map.', 'a view or taste', 'everyday', 'L3', 'work', '{{work}}', 'confirmed', 'very', now(), now(), true); "
                    f"insert into receipts (id, owner, belief_id, quote) values ('{ra}', '{nid}', '{a}', '{QA_}'), ('{rb}', '{nid}', '{b}', 'nobody argues at dinner (probe v2)'), "
                    f"('{re_}', '{nid}', '{e}', 'I was honest about it at church and with my business partner (probe v2)'), ('{rg}', '{nid}', '{g}', 'kept off the map (probe v2 hidden)'), "
                    f"('{rh}', '{nid}', '{h}', 'my mum said so too (probe v2)'), "
                    f"('{rd}', '{nid}', '{d}', 'people lean on me (probe v2)')")
check("seed four fictional confirmed kennings + two receipts for namitest", code in (200, 201), f"sql {code} {'' if code in (200, 201) else str(out)[:160]}")
share_code, _ = run_sql(env, f"insert into share_items (owner, other, belief_id, wording) values ('{nid}', '{seen_by}', '{g}', 'You keep this one off the map.') on conflict do nothing") if seen_by else (0, "")
try:
    s, j = call("GET", "/kennings/map", token=nt)
    st = {x.get("belief_id"): x for x in j.get("stations", [])}
    # v1.80 (CONTRACT.md:104): a kept-off kenning remains in the owner's List as hidden, never in the drawn map.
    check("GET /kennings/map 200, map_version 2, lines list", s == 200 and j.get("map_version") == 2 and isinstance(j.get("lines"), list) and {a, b, c, d, e, f, g, h, dot} <= set(st) and st.get(g, {}).get("hidden") is True, f"{s} v={j.get('map_version')}")
    check("keyword made vs label", st.get(a, {}).get("keyword") == "Fine" and st.get(a, {}).get("keyword_source") == "made"
          and st.get(b, {}).get("keyword") == "Dinner" and st.get(b, {}).get("keyword_source") == "label", f"{st.get(a, {}).get('keyword')}/{st.get(b, {}).get('keyword')}")
    check("memberships: home work + said family, both on the naming receipt", st.get(a, {}).get("memberships") == [
        {"line": "work", "receipt_ids": [ra], "source": "home"}, {"line": "family", "receipt_ids": [ra], "source": "said"}], json.dumps(st.get(a, {}).get("memberships"))[:200])
    check("memberships: home line with no naming word rests on the receipt read", st.get(b, {}).get("memberships") == [{"line": "family", "receipt_ids": [rb], "source": "home"}])
    # QA-B362: a line the person picked that no receipt names rests on the kenning's own receipts, so the sheet has their words.
    check("memberships: the person's own line stands alone and cites the kenning's own receipt", st.get(d, {}).get("memberships") == [{"line": "me", "receipt_ids": [rd], "source": "you"}] and any(r.get("id") == rd for r in j.get("receipts", [])))
    check("shared keyword folds a and c into one group", st.get(a, {}).get("group_id") == st.get(c, {}).get("group_id") and str(st.get(a, {}).get("group_id", "")).startswith("g:"))
    # b's keyword may be shared with a kenning the account already has (then it folds with it); otherwise it folds by line and kind.
    peers = [x for x in st.values() if x.get("belief_id") != b and str(x.get("keyword", "")).lower() == str(st.get(b, {}).get("keyword", "")).lower()]
    want_b = st[peers[0]["belief_id"]].get("group_id") if peers else "k:family:rule"
    check("b folds with its keyword peers, else by home line and kind", st.get(b, {}).get("group_id") == want_b, f"{st.get(b, {}).get('group_id')} peers={len(peers)}")
    check("v1.76: a stored verdict word ('Lazy') falls back to the label's own word", st.get(e, {}).get("keyword") == "Earned"
          and st.get(e, {}).get("keyword_source") == "label", f"{st.get(e, {}).get('keyword')}/{st.get(e, {}).get('keyword_source')}")
    check("v1.76: no word passes -> keyword null, source none", st.get(f, {}).get("keyword") is None and st.get(f, {}).get("keyword_source") == "none",
          f"{st.get(f, {}).get('keyword')}/{st.get(f, {}).get('keyword_source')}")
    check("v1.76: no station on more than two lines; no keyword repeats its own line's name", all(len(x.get("memberships") or []) <= 2 for x in st.values())
          and not any(str(x.get("keyword") or "").lower() in {m.get("line") for m in x.get("memberships") or []} for x in st.values()))
    # QA-B368 (QA 16:28Z): over EVERY station in the response, the account's own included, never only the seeded ones.
    def keyword_shape_ok(x):
        k, src = x.get("keyword"), x.get("keyword_source")
        return (k is None and src == "none") or (isinstance(k, str) and re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", k) is not None and src in ("made", "label"))
    bad = [(x.get("belief_id"), x.get("keyword"), x.get("keyword_source")) for x in j.get("stations", []) if not keyword_shape_ok(x)]
    check("QA-B368: every station is null/none or a plain word with a made/label source; a dot is never a keyword", not bad and len(j.get("stations", [])) >= 8, str(bad[:3]))
    check("QA-B368: a stored dot comes back null/none", st.get(dot, {}).get("keyword") is None and st.get(dot, {}).get("keyword_source") == "none",
          f"{st.get(dot, {}).get('keyword')}/{st.get(dot, {}).get('keyword_source')}")
    check("lines include work, family, me", {"work", "family", "me"} <= set(j.get("lines") or []), str(j.get("lines")))
    rcp = {x.get("id"): x for x in j.get("receipts") or []}
    check("v1.77: top-level receipts carry the person's exact words and an ISO date for cited ids", rcp.get(ra, {}).get("quote") == QA_
          and rcp.get(rb, {}).get("quote") == "nobody argues at dinner (probe v2)" and str(rcp.get(ra, {}).get("said_at", "")).endswith("Z"), json.dumps(rcp.get(ra))[:160])
    cited = {i for x in st.values() for m in x.get("memberships") or [] for i in m.get("receipt_ids") or []}
    # v1.82 (CONTRACT.md:101): the owner's List sheet retains the hidden station's cited receipt.
    check("v1.77: every receipt sent is cited by a membership; a hidden kenning's receipt stays on the owner's read", set(rcp) <= cited and rg in rcp and rcp[rg].get("quote") == "kept off the map (probe v2 hidden)")
    check("v1.77: church, honest and 'partner' alone add no line (PSY: family, relationships, work, money only; 'my partner' only)",
          st.get(e, {}).get("memberships") == [{"line": "work", "receipt_ids": [re_], "source": "home"}], json.dumps(st.get(e, {}).get("memberships"))[:200])
    check("v1.77: a harsh self statement gets no second line", st.get(h, {}).get("memberships") == [{"line": "meaning", "receipt_ids": [rh], "source": "home"}],
          json.dumps(st.get(h, {}).get("memberships"))[:200])
    # PSY 15 Nov point 4 (migration 0065): a's second line (family) was stored on that GET; two newer receipts naming money never swap it.
    code, _ = run_sql(env, f"insert into receipts (id, owner, belief_id, quote) values ('{rm1}', '{nid}', '{a}', 'the rent is due (probe v2 sticky)'), "
                      f"('{rm2}', '{nid}', '{a}', 'money again (probe v2 sticky)')")
    s2, j2 = call("GET", "/kennings/map", token=nt)
    st2 = {x.get("belief_id"): x for x in j2.get("stations", [])}
    check("v1.77: the second line never changes silently: newer receipts naming money keep a on family", code in (200, 201) and s2 == 200
          and [m.get("line") for m in st2.get(a, {}).get("memberships") or []] == ["work", "family"], json.dumps(st2.get(a, {}).get("memberships"))[:200])
    seen_status, seen = call("GET", f"/kennings/map?seen_by={seen_by}", token=nt) if seen_by else (0, {})
    s, j = call("GET", "/kennings/map", token=jt)
    check("a kept-off station and its receipt never leave the owner's read", s == 200 and not any(x in json.dumps(j) for x in (a, b, c, d, e, f, g, h, dot, ra, rb))
          and "probe v2" not in json.dumps(j) and share_code in (200, 201) and seen_status == 200 and g not in station_ids(seen) and rg not in json.dumps(seen)
          and "probe v2 hidden" not in json.dumps(seen), f"jantest={s} seen_by={seen_status} share={share_code} g_in_seen={g in station_ids(seen)} rg_in_seen={rg in json.dumps(seen)} hidden_words_in_seen={'probe v2 hidden' in json.dumps(seen)}")
finally:
    code, _ = run_sql(env, f"delete from share_items where owner = '{nid}' and belief_id = '{g}'; delete from receipts where id in ('{ra}','{rb}','{re_}','{rg}','{rh}','{rm1}','{rm2}','{rd}'); delete from beliefs where id in ('{a}','{b}','{c}','{d}','{e}','{f}','{g}','{h}','{dot}')")
    print("cleanup sql", code)
print(f"{sum(r[1] for r in results)}/{len(results)} passed")
sys.exit(0 if all(r[1] for r in results) else 1)
