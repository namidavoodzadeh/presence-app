# Handover: Mac mini setup session

From: Nami (owner), prepared by the setup chat on 24 Nov 2026.

You are executing setup tasks on the Mac mini. You are not a manager, reviewer or approver in the new system; do not recreate the old queue, lanes, watchdog or approval steps.

1. Pause the old build lanes: in `/Users/nami/Documents/Codex/Presence` run `ops/pause.sh` and confirm from `outputs/control/health.json` that no lane is running. Leave the old repository and its data untouched otherwise.
2. Clone `https://github.com/namidavoodzadeh/presence-app` to `/Volumes/PresenceSSD/presence-app`. Read `AGENTS.md`.
3. Do the tasks in `docs/setup/TASKS.md`, Part A remaining then Part B, in id order. A task is done only when its check passes. Write each result to `docs/verification/` and push.
4. Changes to `.github/`, `policy/`, `tools/` and `contract/` are expected in this setup; set `PROTECT_ALLOW` accordingly for this session only.
5. If a check cannot pass after two attempts, stop that task, record why, and continue with tasks that do not depend on it.
6. When finished, write `docs/verification/setup-report.md`: one line per task (pass, fail, blocked), and one list titled "Needs Nami" with exact, verified steps.

Do not start Part C. Do not retire the old background services.
