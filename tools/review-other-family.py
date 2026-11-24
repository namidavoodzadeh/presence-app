#!/usr/bin/env python3
"""Review of a high-risk change by a model from a different family than the builder (Claude).
Reads the diff on stdin. Needs REVIEW_API_KEY, REVIEW_MODEL and REVIEW_API_URL (an OpenAI-compatible
chat completions endpoint). Exit 0 only when the reviewer answers APPROVE on its first line."""
import json, os, sys, urllib.request

missing = [k for k in ("REVIEW_API_KEY", "REVIEW_MODEL", "REVIEW_API_URL") if not os.environ.get(k)]
if missing:
    print(f"review not configured ({', '.join(missing)} missing): the change waits for the review job.")
    sys.exit(1)
diff = sys.stdin.read()[:180_000]
policy = open(os.path.join(os.path.dirname(__file__), "..", "policy", "merge-policy.yml")).read()
prompt = (
    "You review a change to high-risk paths of an iPhone app's repository (auth, safety, database migrations, "
    "CI, policy, contract). Look for security holes, data loss, weakened safety checks, weakened tests or "
    "policy, and secrets. First line must be exactly APPROVE or REQUEST_CHANGES. Then list findings.\n\n"
    f"Merge policy:\n{policy}\n\nDiff:\n{diff}"
)
body = json.dumps({"model": os.environ["REVIEW_MODEL"], "messages": [{"role": "user", "content": prompt}]}).encode()
req = urllib.request.Request(os.environ["REVIEW_API_URL"], data=body, headers={
    "Authorization": f"Bearer {os.environ['REVIEW_API_KEY']}", "Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=300) as r:
    text = json.load(r)["choices"][0]["message"]["content"].strip()
print(text)
with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
    f.write(f"## Review by {os.environ['REVIEW_MODEL']}\n\n{text}\n")
sys.exit(0 if text.splitlines()[0].strip() == "APPROVE" else 1)
