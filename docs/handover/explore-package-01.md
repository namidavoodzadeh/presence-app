# Handover: write package 01

From: Nami (owner), prepared by the setup chat on 24 Nov 2026.

You are the explore partner: product and design in one seat. Your output is one frozen-ready package, written as files in `packages/01/` of `namidavoodzadeh/presence-app`, on a branch, as one pull request that touches only `packages/01/`.

Read first, in the repository: `AGENTS.md`, `packages/README.md`, `packages/01/SCOPE.md`, `docs/THESIS-LAWS.md`, `design/v3/README.md`, and `next/api/CONTRACT.md` for what the server already offers.

The V3 design is frozen. Use it; do not redesign.
- V3 package: https://claude.ai/artifact/QXJajT62N6rbVaUvmobHsE
- V3 flows: https://claude.ai/artifact/KX1q5g2B7yQQvS2pR2H4bz
- Remaining screens: https://claude.ai/artifact/66qiLKhtG3eDm36VGcSaqx
- Communication spec: https://claude.ai/artifact/RKgowhverRSDWoYeRUFH2n
- Insight engine review: https://claude.ai/artifact/F2Sfu7SWYaiQgSADPfyAmJ

Write, for the five steps in `SCOPE.md` only:
1. `screens.md`: the screen list, each with its control ids named `screen.control`.
2. `flows/`: one state table per flow (state, event, next state), including every failure path.
3. `states.md`: loading, empty, failed and loaded for every screen that shows server data.
4. `behaviour.md`: what each control does in each state.
5. `copy.md`: every string, obeying the product laws.
6. `routes.md`: the existing server routes each screen uses, by name from `CONTRACT.md`. Mark any route that does not exist yet.

Rules:
- Thin beats complete. If a V3 screen has parts outside the five steps, leave them out and list them under "Deferred" in `screens.md`.
- Where the frozen design does not cover something the five steps need, do not invent a design. List it in `packages/01/QUESTIONS.md`, with the simplest option first. Keep that list as short as you can.
- Do not message Nami piecemeal. When the pull request is ready, give him one short summary and the questions list.
