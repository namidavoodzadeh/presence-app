// QA-B415 / QA-B416: a person who was blocked learns no block state through
// Bridge or Check-in, and report accepts only a linked profile. Route level,
// no database or network.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { type Route, routes } from "../api/lib/router.ts";
import "../api/bridge.ts";
import "../api/checkin.ts";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
type Row = Record<string, unknown>;

class Query implements PromiseLike<{ data: Row | null; error: null }> {
  private readonly filters: Array<[string, unknown]> = [];
  constructor(private readonly links: Row[]) {}
  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  maybeSingle() {
    return this;
  }
  then<TResult1 = { data: Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.links.find((row) => this.filters.every(([key, value]) => row[key] === value)) ?? null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function handler(method: string, path: string): Route["handler"] {
  const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
  if (!route) throw new Error(`route missing: ${method} ${path}`);
  return route.handler;
}

function context(path: string, caller: string, links: Row[], body: Row = {}) {
  const client = { from: (_table: string) => new Query(links) };
  const route = routes.find((candidate) => candidate.pattern.test(path));
  if (!route) throw new Error(`route missing: ${path}`);
  const match = route.pattern.exec(path)!;
  const params = Object.fromEntries(route.keys.map((key, index) => [key, match[index + 1]]));
  return {
    env: { checkIn: true },
    req: new Request(`https://fixture.invalid${path}`),
    url: new URL(`https://fixture.invalid${path}`),
    params,
    caller: { id: caller, isPreview: false, db: client },
    service: client,
    tz: "UTC",
    body: () => Promise.resolve(body),
  } as never;
}

async function rejectsNeutral(handler: Route["handler"], path: string, links: Row[], body: Row = {}) {
  const error = await assertRejects(
    () => handler(context(path, B, links, body)),
    ApiError,
  );
  assertEquals(error.code, "not_found");
  assertEquals(error.extra, { where: "link" });
}

Deno.test("QA-B415: every listed blocked-side route is indistinguishable from an absent link", async () => {
  const links = [{ person_a: A, person_b: B, status: "blocked", blocked_by: A }];
  await rejectsNeutral(handler("GET", `/threads/${A}`), `/threads/${A}`, links);
  await rejectsNeutral(handler("POST", "/bridges"), "/bridges", links, { person_id: A });
  await rejectsNeutral(handler("GET", `/checkin/${A}`), `/checkin/${A}`, links);
  await rejectsNeutral(handler("PUT", `/checkin/${A}/schedule`), `/checkin/${A}/schedule`, links);
  await rejectsNeutral(handler("GET", `/people/${A}/map`), `/people/${A}/map`, links);
});

Deno.test("QA-B416: reporting an unlinked or absent person stops before reports.insert", async () => {
  await rejectsNeutral(handler("POST", `/links/${A}/report`), `/links/${A}/report`, []);
});
