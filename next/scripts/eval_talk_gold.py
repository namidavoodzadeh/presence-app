#!/usr/bin/env python3
"""Talk gold set for the deploy gate (replaces 'talk skipped'). STAGING ONLY, fictional personas only.

Each case in next/evals/talk_gold.json is a fictional persona's told episodes (the same turns as the W3.4 calibration set). A fresh
staging test account has one Talk with them, then finish. A case passes only when every mechanical check holds:
  1 finish answers 200 and returns at least one belief card                      (Talk still extracts)
  2 every receipt quote is the person's own words from this Talk, verbatim        (law 2; chips excepted)
  3 every card has at least one receipt                                           (law 2)
  4 no card wording contains a banned or clinical word                            (laws 4, 5, 7)
  5 no turn that shows no risk is answered with resources / a stop               (law 8 not tripped by ordinary talk)
Writes outputs/engine/evals/talk-gold-<date>-<tag>.md ending in '**P of N pass; C¢ spent.**' (deploy_gate.parse_report reads it).

    python3 next/scripts/eval_talk_gold.py --tag gate-abc123 [--cap-cents 60]
    python3 next/scripts/eval_talk_gold.py --check-only   # validate talk_gold.json shape, no network
"""
from __future__ import annotations
import argparse, json, os, re, secrets, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
GOLD = HERE.parent / "evals" / "talk_gold.json"
BANNED = re.compile(r"\b(please|should|healthy|unhealthy|toxic|fix|improve|wrong|better|disorder|depress\w*|anxiety|anxious disorder|trauma\w*|narcissi\w*|attachment style|schema|diagnos\w*|therapy)\b", re.I)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def diagnosis(turn_status: list[int], turn_ms: list[int], cid, finish_status: int, fin: dict, fin_ms: int) -> str:
    """Where a failed case broke, in numbers (QA/COO 17:20Z 15 Nov: 'no cards from finish' alone cannot tell a turn error from a finish
    timeout). Statuses and times only, never user text. Pure, unit-tested."""
    err = fin.get("error") if isinstance(fin, dict) else None
    code = (err.get("code") if isinstance(err, dict) else err) or ""
    return (f"[turn statuses {turn_status}, turn ms {turn_ms}, conversation {'yes' if cid else 'none: finish not called'}, "
            f"finish status {finish_status if cid else 'n/a'}, finish ms {fin_ms if cid else 'n/a'}, finish error '{code}']")


def score_case(case: dict, finish: dict, status: int, replies: list[dict]) -> list[str]:
    """Failed checks for one case, as short strings; empty means pass. Pure function so it is unit-tested without a network."""
    bad = []
    beliefs = finish.get("beliefs") or []
    if status != 200 or not beliefs:
        bad.append("no cards from finish")
    said = norm(" ".join(case["turns"]))
    for b in beliefs:
        rs = b.get("receipts") or []
        if not rs:
            bad.append(f"card '{b.get('label')}' has no receipt")
        for r in rs:
            if r.get("kind") == "choice":
                continue
            if norm(str(r.get("quote"))) not in said:
                bad.append(f"receipt for '{b.get('label')}' is not the person's words")
        for field in ("label", "statement"):
            m = BANNED.search(str(b.get(field) or ""))
            if m:
                bad.append(f"banned word '{m.group(0)}' in {field}")
    for rep in replies:
        if (rep.get("risk") or {}).get("level") not in (None, "none"):
            bad.append("risk stop on an ordinary turn")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="manual")
    ap.add_argument("--cap-cents", type=float, default=60)
    ap.add_argument("--check-only", action="store_true")
    a = ap.parse_args()
    gold = json.loads(GOLD.read_text())
    cases = gold["cases"]
    assert all(c.get("id") and c.get("turns") for c in cases), "every case needs id and turns"
    if a.check_only:
        print(f"{len(cases)} cases ok"); return 0
    os.environ["PRESENCE_SUPABASE_ENV"] = "staging"
    sys.path.insert(0, str(HERE))
    import seed_staging_newcomer as sn
    import seed_preview as sp
    from staging_setup import STAGING, load as load_env
    from supabase_api import run_sql
    env = load_env(STAGING)
    if sp.load()["SUPABASE_PROJECT_REF"] != env["SUPABASE_PROJECT_REF"]:
        print("refusing: the loaded project is not the staging project"); return 1
    base = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/api"

    def spent() -> float:
        _, body = run_sql(env, "select coalesce(sum(coalesce(spent_micros, reserved_micros)),0) as m from usage_ledger where utc_day=(now() at time zone 'utc')::date;")
        try: return float(json.loads(body)[0]["m"]) / 10000.0
        except Exception: return 0.0

    def call(token, path, body):
        h = {"content-type": "application/json", "apikey": env["SUPABASE_ANON_KEY"], "authorization": "Bearer " + token}
        req = urllib.request.Request(base + path, method="POST", headers=h, data=json.dumps(body).encode())
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read() or b"{}")
            except Exception: return e.code, {}

    start, passed, lines = spent(), 0, []
    for c in cases:
        if spent() - start >= a.cap_cents:
            lines.append(f"- {c['id']}: not run (cap {a.cap_cents:.0f}¢ reached) FAIL"); continue
        email, password = f"gold-{secrets.token_hex(4)}@staging.presence.invalid", secrets.token_urlsafe(24)
        uid = sp.ensure_user(env, email, password, "newcomer")
        run_sql(env, sn.profile_sql(uid))
        token = sn.sign_in(env, email, password)
        cid, replies, turn_status, turn_ms = None, [], [], []
        for t in c["turns"]:
            t0 = time.monotonic()
            s, j = call(token, "/talk/turn", {"conversation_id": cid, "text": t, "mode": "text"})
            turn_status.append(s); turn_ms.append(int((time.monotonic() - t0) * 1000))
            cid = cid or (j.get("conversation") or {}).get("id")
            rep = j.get("reply") or {}
            if rep.get("state") == "consent":
                call(token, "/talk/consent", {"conversation_id": cid, "area": (rep.get("consent") or {}).get("area", "body"), "label": "this", "answer": "never"})
            replies.append(rep)
        f0 = time.monotonic()
        s, fin = call(token, "/talk/finish", {"conversation_id": cid, "ratings": []}) if cid else (0, {})
        fin_ms = int((time.monotonic() - f0) * 1000)
        bad = score_case(c, fin, s, replies)
        passed += not bad
        lines.append(f"- {c['id']}: {'PASS' if not bad else 'FAIL — ' + '; '.join(bad)} ({len(fin.get('beliefs') or [])} cards)"
                     + ("" if not bad else " " + diagnosis(turn_status, turn_ms, cid, s, fin, fin_ms)))
    cents = int(round(spent() - start))
    out = Path(os.environ.get("PRESENCE_OPERATIONS_HOME") or HERE.parents[3]) / "outputs" / "engine" / "evals" / f"talk-gold-{time.strftime('%Y-%m-%d', time.gmtime())}-{a.tag}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("# Talk gold set (staging)\n\n" + "\n".join(lines) + f"\n\n**{passed} of {len(cases)} pass; {cents}¢ spent.**\n")
    print(f"{passed} of {len(cases)} pass; {cents}¢ spent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
