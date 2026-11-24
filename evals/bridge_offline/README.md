# Bridge offline evaluation

Run a frozen fictional evaluation without staging, HTTP, accounts, or Supabase:

```sh
deno run -A evals/bridge_offline/run.ts --variant baseline
deno run -A evals/bridge_offline/run.ts --variant k0107-belief-link
deno run -A evals/bridge_offline/run.ts --variant link-mid
deno run -A evals/bridge_offline/run.ts --variant vague-strict
deno run -A evals/bridge_offline/run.ts --variant you-blame-strict
deno run -A evals/bridge_offline/run.ts --variant combo
deno run -A evals/bridge_offline/summary.ts
deno run -A evals/bridge_offline/summary_round2.ts
```

Use `--only p01-01,p01-02` for a focused rerun. Replies are cached from the
exact prompt, model, and input; unchanged reruns cost no model calls. The
nightly scheduler entry point is `deno run -A evals/bridge_offline/nightly.ts`.
