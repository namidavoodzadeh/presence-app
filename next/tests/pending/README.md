# Pending acceptance tests

Tests written before their code (setup task C4). They are excluded from `deno task test` (see `next/deno.json`, `test.exclude`) so `main` stays green.

The first step of building an issue is to move its file from `next/tests/pending/` to `next/tests/` unchanged (`git mv`). Each file finds the repository root itself, so it runs from either folder. After the move the file is read-only like every other test.

Each file starts with "API the tests expect": the names and shapes the builder provides.
