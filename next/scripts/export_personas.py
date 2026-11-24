"""Write evals/personas (exemplars + cohort + the generated cohort) to next/fixtures/personas.json.

Run from the repository root: python3 next/scripts/export_personas.py
The engine reads the JSON; the Python catalog stays the source.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from evals.personas.catalog import load_personas  # noqa: E402

OUT = ROOT / "next/fixtures/personas.json"
personas = load_personas()
OUT.write_text(json.dumps({"version": 1, "personas": personas}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("%d personas -> %s" % (len(personas), OUT.relative_to(ROOT)))
