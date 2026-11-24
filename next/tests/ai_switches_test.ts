// sre-07: one kill switch per AI feature, and the release id on every ledger row (migration 0040).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { PostgresLedger, resetSwitchCache } from "../api/lib/ledger.ts";
import { ApiError, STATUS } from "../api/lib/errors.ts";
import { RELEASE_ID } from "../api/lib/release_id.ts";

// A fake service client: ai_switches rows and the calls ledger_reserve / ledger_settle receive.
function fake(off: string[], switchError = false) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      assertEquals(table, "ai_switches");
      return {
        select: () => ({
          eq: (_c: string, _v: unknown) =>
            Promise.resolve(
              switchError
                ? { data: null, error: { message: "down" } }
                : { data: off.map((feature) => ({ feature })), error: null },
            ),
        }),
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: fn === "ledger_reserve" ? { ok: true, id: "L1" } : null, error: null });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, calls };
}
const scope = (feature?: "talk" | "bridge" | "import" | "mirror") => ({
  person: "p",
  ownerPreview: false,
  feature,
});

Deno.test("a switched-off feature is refused before the ledger is touched; others still run", async () => {
  resetSwitchCache();
  const { db, calls } = fake(["bridge"]);
  const bridge = new PostgresLedger(db, scope("bridge"));
  const r = await bridge.reserve("n1", "next-engine", 5);
  assertEquals(r.ok, false);
  assert(!calls.some((c) => c.fn === "ledger_reserve"));
  const e = bridge.refusalError("bridge");
  assertEquals(e.code, "ai_off");
  assertEquals(e.extra.scope, "bridge");
  assertEquals(STATUS.ai_off, 503);
  assert(!/daily|limit|12:00/i.test(e.message));
  const talk = new PostgresLedger(db, scope("talk"));
  assertEquals((await talk.reserve("n2", "next-engine", 5)).ok, true);
});

Deno.test("no feature (evals, agents) is never switched; an unreadable switch table fails open", async () => {
  resetSwitchCache();
  const a = fake(["talk", "bridge", "import", "mirror"]);
  assertEquals((await new PostgresLedger(a.db, scope()).reserve("n", "eval:harness", 1)).ok, true);
  resetSwitchCache();
  const b = fake([], true);
  assertEquals((await new PostgresLedger(b.db, scope("talk")).reserve("n", "k", 1)).ok, true);
});

Deno.test("settle writes the release id and the model", async () => {
  resetSwitchCache();
  const { db, calls } = fake([]);
  const l = new PostgresLedger(db, scope("talk"));
  await l.reserve("n", "k", 3);
  await l.settle("n", 2, "rcpt", "claude-sonnet-5-5");
  const s = calls.find((c) => c.fn === "ledger_settle")!;
  assertEquals(s.args.p_release, RELEASE_ID);
  assertEquals(s.args.p_model, "claude-sonnet-5-5");
});

Deno.test("ApiError ai_off carries scope; migration 0040: default on, release stamped, old four-argument settle still works", async () => {
  assert(new ApiError("ai_off", "x", { scope: "talk" }).code === "ai_off");
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table public.profiles(id uuid primary key);
    create table public.usage_ledger (id uuid primary key default gen_random_uuid(), kind text not null default 'k', reserved_micros bigint not null default 100, spent_micros bigint, model text, receipt text, settled_at timestamptz);
    create function public.ledger_settle(p_id uuid, p_spent_micros bigint, p_model text, p_receipt text default null) returns void language sql as $$
      update usage_ledger set spent_micros = least(p_spent_micros, reserved_micros), model = p_model, receipt = p_receipt, settled_at = now() where id = p_id and settled_at is null; $$;`);
  await pg.exec(
    await Deno.readTextFile(
      new URL("../../supabase/migrations/0040_ai_switches_release.sql", import.meta.url),
    ),
  );
  const sw = await pg.query<{ feature: string; enabled: boolean }>(
    "select feature, enabled from ai_switches order by 1",
  );
  assertEquals(sw.rows.map((r) => r.feature), ["bridge", "import", "mirror", "talk"]);
  assert(sw.rows.every((r) => r.enabled));
  await pg.exec(
    "insert into usage_ledger(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002')",
  );
  await pg.query(
    "select ledger_settle('00000000-0000-0000-0000-000000000001', 50, 'm', 'r', 'abc1234@2026-11-09')",
  );
  await pg.query("select ledger_settle('00000000-0000-0000-0000-000000000002', 50, 'm', 'r')");
  const rows = await pg.query<{ release: string | null }>("select release from usage_ledger order by id");
  assertEquals(rows.rows.map((r) => r.release), ["abc1234@2026-11-09", null]);
  await pg.close();
});
