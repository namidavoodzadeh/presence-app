#!/usr/bin/env python3
"""Batch judge for the fictional offline Bridge evaluator.

It reuses the lab's protected OpenAI loader and meter.  Inputs and outputs are
only fictional drafts, gold labels, and generated insight wording.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from evals.lab.openai_client import LabModelClient

CACHE = ROOT / "evals/bridge_offline/judge-cache"


def cached_complete(client: LabModelClient, prompt: str) -> dict[str, Any]:
    """Cache by configured judge model and exact prompt; errored replies never cache."""
    config = json.loads((ROOT / "outputs/lab/config.json").read_text(encoding="utf-8"))
    model = str(config["judge_model"]["name"])
    key = hashlib.sha256(json.dumps({"model": model, "prompt": prompt}, sort_keys=True).encode("utf-8")).hexdigest()
    path = CACHE / f"{key}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        pass
    answer = client.complete(prompt, "judge")
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answer, sort_keys=True) + "\n", encoding="utf-8")
    return answer


def calibration_prompt(row: dict[str, Any]) -> str:
    return ("Classify this Bridge note against its written gold. JSON only {correct:boolean,why:string}. "
            "Treat the written gold as authoritative. A correct note is specific to the draft, gentle, descriptive rather than prescriptive, "
            "matches gold, contains no clinical or evaluative language, and never quotes an unshared item. "
            "For quiet gold, 'Nothing here is likely to get in the way' is correct.\n"
            f"DRAFT={json.dumps(row['draft'])}\nGOLD={json.dumps(row['gold'])}\nNOTE={json.dumps(row['note'])}")


def wording_prompt(row: dict[str, Any]) -> str:
    return ("Judge this fictional Bridge insight against its written gold. JSON only "
            "{passes:boolean,law_clean:boolean,why:string}. A pass is specific to this draft, gentle, descriptive not prescriptive, "
            "matches the gold flaw, belief, or quiet expectation, has no clinical/evaluative language, and does not quote a receiver item. "
            "A quiet message must not invent a friction, belief link, or receiver reading.\n"
            f"DRAFT={json.dumps(row['draft'])}\nGOLD={json.dumps(row['gold'])}\nNOTE={json.dumps(row['note'])}")


def evaluate_one(kind: str, row: dict[str, Any], client: LabModelClient) -> dict[str, Any]:
    try:
        answer = cached_complete(client, calibration_prompt(row) if kind == "calibration" else wording_prompt(row))
        return {"id": row["id"], "error": None, "correct": bool(answer.get("correct" if kind == "calibration" else "passes")),
                "law_clean": bool(answer.get("law_clean", True)), "why": str(answer.get("why") or "")}
    except Exception as error:  # a row remains inspectable and never disappears from the report
        return {"id": row["id"], "error": f"{type(error).__name__}: {error}", "correct": False, "law_clean": False, "why": ""}


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: judge.py INPUT.json OUTPUT.json")
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    client = LabModelClient(require_api=True)
    def many(kind: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(lambda row: evaluate_one(kind, row, client), rows))
    output = {"calibration": many("calibration", list(payload.get("calibration") or [])),
              "wording": many("wording", list(payload.get("wording") or []))}
    Path(sys.argv[2]).write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
