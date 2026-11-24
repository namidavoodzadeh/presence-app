// A minimal in-memory stand-in for the Supabase query builder, shared by Mirror's fixture tests: just the chain
// mirror.ts's pipeline actually calls (select/insert/update/delete, eq/neq/in/not/order/limit, single/maybeSingle, the
// {count, head} select option, and the one join mirror.ts relies on). Never hosted, never a real network call.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

let tick = 0;
function nextTick() {
  return tick++;
}

class FakeQuery implements PromiseLike<{ data: unknown; count?: number; error: null }> {
  #kind: "select" | "update" | "insert" | "delete" = "select";
  #changes: FakeRow = {};
  #inserted: FakeRow[] = [];
  #predicates: Array<(row: FakeRow) => boolean> = [];
  #single: "one" | "maybe" | null = null;
  #order: string | null = null;
  #limit: number | null = null;
  #withCount = false;
  #embed: "mirror_links_owner_fkey" | null = null;

  constructor(private readonly tables: FakeTables, private readonly table: string) {}

  select(columns: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.#withCount = true;
    if (this.table === "mirror_links" && columns.includes("profiles!mirror_links_owner_fkey")) {
      this.#embed = "mirror_links_owner_fkey";
    }
    return this;
  }
  eq(column: string, value: unknown) {
    this.#predicates.push((row) => row[column] === value);
    return this;
  }
  gte(column: string, value: unknown) {
    // A row the fake inserted has no created_at: it counts as just created, as the database default would make it.
    this.#predicates.push((row) => row[column] === undefined || String(row[column]) >= String(value));
    return this;
  }
  neq(column: string, value: unknown) {
    this.#predicates.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null) {
    this.#predicates.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.#predicates.push((row) => values.includes(row[column]));
    return this;
  }
  not(column: string, op: string, value: unknown) {
    if (op === "is" && value === null) {
      this.#predicates.push((row) => row[column] !== null && row[column] !== undefined);
    }
    return this;
  }
  order(column: string) {
    this.#order = column;
    return this;
  }
  limit(n: number) {
    this.#limit = n;
    return this;
  }
  update(value: FakeRow) {
    this.#kind = "update";
    this.#changes = value;
    return this;
  }
  insert(value: FakeRow | FakeRow[]) {
    this.#kind = "insert";
    const rows = Array.isArray(value) ? value : [value];
    this.#inserted = rows.map((row) => ({
      id: row.id ??
        `${this.table}-${(this.tables[this.table] ??= []).length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      created_at: row.created_at ?? new Date(Date.now() + nextTick()).toISOString(),
      ...row,
    }));
    return this;
  }
  /** Insert, or replace the row that has the same values in the onConflict columns (comma list). */
  upsert(value: FakeRow, opts?: { onConflict?: string }) {
    const keys = (opts?.onConflict ?? "id").split(",").map((k) => k.trim());
    const rows = this.tables[this.table] ??= [];
    this.tables[this.table] = rows.filter((r) => !keys.every((k) => r[k] === value[k]));
    return this.insert(value);
  }
  delete() {
    this.#kind = "delete";
    return this;
  }
  maybeSingle() {
    this.#single = "maybe";
    return this;
  }
  single() {
    this.#single = "one";
    return this;
  }
  #matches(row: FakeRow) {
    return this.#predicates.every((p) => p(row));
  }
  #withEmbed(row: FakeRow): FakeRow {
    if (this.#embed !== "mirror_links_owner_fkey") return row;
    const profile = (this.tables.profiles ?? []).find((p) => p.id === row.owner) ?? null;
    return {
      ...row,
      profiles: profile ? { name: profile.name, is_preview: profile.is_preview ?? false } : null,
    };
  }
  #run(): { data: unknown; count?: number; error: null } {
    const rows = this.tables[this.table] ??= [];
    if (this.#kind === "insert") {
      rows.push(...this.#inserted);
      const data = this.#inserted.map((r) => ({ ...r }));
      return { data: this.#single ? data[0] ?? null : data, error: null };
    }
    let matched = rows.filter((row) => this.#matches(row));
    if (this.#kind === "update") {
      for (const row of matched) Object.assign(row, this.#changes);
    } else if (this.#kind === "delete") {
      this.tables[this.table] = rows.filter((row) => !this.#matches(row));
    }
    if (this.#order) {
      matched = [...matched].sort((a, b) => String(a[this.#order!]).localeCompare(String(b[this.#order!])));
    }
    if (this.#limit !== null) matched = matched.slice(0, this.#limit);
    const copied = matched.map((row) => this.#withEmbed({ ...row }));
    const out: { data: unknown; count?: number; error: null } = {
      data: this.#single ? copied[0] ?? null : copied,
      error: null,
    };
    if (this.#withCount) out.count = matched.length;
    return out;
  }
  then<T>(resolve: (v: { data: unknown; count?: number; error: null }) => T) {
    return Promise.resolve(resolve(this.#run()));
  }
}

export function fakeClient(tables: FakeTables): SupabaseClient {
  return { from: (table: string) => new FakeQuery(tables, table), rpc: () => Promise.resolve({ data: { ok: true, id: "ledger-row" }, error: null }) } as unknown as SupabaseClient;
}
