# Bridge W3.3 eval v1

HQ source: `outputs/engine/inbox/bridge-w3-3-v1.json`, version 1 (CPO, 2026-11-02).

`cases.json` is that source copied byte-for-byte. `positive_safety_cases.json` adds the fictional law-8
positives required by W3.2 without changing the HQ bank. The scorer reads binary criterion decisions from a
recorded or mocked output file and reports case, kind, and per-rule pass counts. It does not infer a verdict
from generated prose.

Run the checked-in mock replay from `next/`:

```sh
deno task bridge:w3.3
```

Score another recorded output file:

```sh
deno task bridge:w3.3 -- path/to/outputs.json
```
