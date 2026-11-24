// QA-B225 / QA-B229 class guard. Root cause (9 Nov, hosted v59): PUT /checkin/:person/schedule wrote check_ins with
// the caller's own session, but the table had only read and delete policies, so every save was refused by row level
// security and the phone showed "Couldn't save the check-in" (HTTP 500). 0047 fixed it; 0048 (parked_notes insert) was
// the same class, found later. This test reads every API write made with the caller's own client and fails if the
// migrations give that table no policy for that command.
import { assert, assertEquals } from "jsr:@std/assert@1";

const root = new URL("../../", import.meta.url);
const migDir = new URL("supabase/migrations/", root);
const apiDirs = [new URL("next/api/", root), new URL("next/api/lib/", root)];

type Policies = { rls: Set<string>; cmds: Map<string, Set<string>> };

export function readPolicies(skip: (name: string) => boolean = () => false): Policies {
  const names = [...Deno.readDirSync(migDir)].map((e) => e.name).filter((n) => n.endsWith(".sql") && !skip(n)).sort();
  const rls = new Set<string>();
  const byName = new Map<string, Map<string, string>>(); // table -> policy name -> command
  for (const n of names) {
    const sql = Deno.readTextFileSync(new URL(n, migDir)).replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi)) rls.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/(create|drop)\s+policy\s+(?:if\s+exists\s+)?"?([\w ]+?)"?\s+on\s+(?:public\.)?"?(\w+)"?([^;]*);/gi)) {
      const [, verb, name, table, rest] = m;
      const t = table.toLowerCase();
      if (!byName.has(t)) byName.set(t, new Map());
      if (verb.toLowerCase() === "drop") { byName.get(t)!.delete(name); continue; }
      const to = /\bto\s+([\w, ]+?)(?=\s+using|\s+with|\s*$)/i.exec(rest);
      if (to && !/\b(?:authenticated|public)\b/i.test(to[1])) continue; // service_role-only policies don't help the caller
      const f = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(rest);
      byName.get(t)!.set(name, f ? f[1].toLowerCase() : "all");
    }
  }
  const cmds = new Map<string, Set<string>>();
  for (const [t, m] of byName) cmds.set(t, new Set(m.values()));
  return { rls, cmds };
}

/** The region of `src` belonging to the innermost block that contains `at`. */
function enclosingBlock(src: string, at: number): [number, number] {
  let depth = 0, open = -1;
  for (let i = at; i >= 0; i--) {
    if (src[i] === "}") depth++;
    else if (src[i] === "{") { if (depth === 0) { open = i; break; } depth--; }
  }
  if (open === -1) return [0, src.length];
  depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return [open, i];
  }
  return [open, src.length];
}

const CALLER_DB = /const\s+\{[^}]*\bdb\b[^}]*\}\s*=\s*me\(ctx\)|const\s+db\s*=\s*(?:ctx\.)?caller!?\.db\b/g;
const WRITE = /\bdb\.from\("(\w+)"\)((?:\s*\.(?!from\b)\w+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*)/g;

/** Every (file, table, op) the API writes with the caller's own client: in a scope that binds db from the caller,
 *  and in local helpers that scope hands `db` to (one level). */
export function callerWrites(): { file: string; table: string; op: string }[] {
  const out: { file: string; table: string; op: string }[] = [];
  for (const dir of apiDirs) {
    for (const e of Deno.readDirSync(dir)) {
      if (!e.isFile || !e.name.endsWith(".ts")) continue;
      const src = Deno.readTextFileSync(new URL(e.name, dir));
      const helpers = new Map<string, [number, number]>();
      for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(\s*db\s*:\s*SupabaseClient/g)) {
        helpers.set(m[1], enclosingBlock(src, src.indexOf("{", m.index! + m[0].length)));
      }
      const regions: [number, number][] = [];
      for (const m of src.matchAll(CALLER_DB)) {
        const r = enclosingBlock(src, m.index!);
        regions.push(r);
        const body = src.slice(r[0], r[1]);
        for (const [name, hr] of helpers) if (new RegExp(String.raw`\b${name}\(\s*db\b`).test(body)) regions.push(hr);
      }
      for (const [a, b] of regions) {
        for (const w of src.slice(a, b).matchAll(WRITE)) {
          for (const op of w[2].matchAll(/\.(insert|upsert|update|delete)\(/g)) out.push({ file: e.name, table: w[1], op: op[1] });
        }
      }
    }
  }
  return out;
}

export function missingPolicies(p: Policies): string[] {
  const miss = new Set<string>();
  for (const w of callerWrites()) {
    if (!p.rls.has(w.table)) continue;
    const have = p.cmds.get(w.table) ?? new Set();
    for (const c of w.op === "upsert" ? ["insert", "update"] : [w.op]) {
      if (!have.has(c) && !have.has("all")) miss.add(`${w.file}: db.from("${w.table}").${w.op} with the caller's session, but no ${c} policy on ${w.table}`);
    }
  }
  return [...miss].sort();
}

Deno.test("every write the API makes with the caller's own session has a row-level-security policy for it", () => {
  const writes = callerWrites();
  assert(writes.length > 20, `scanner found only ${writes.length} caller writes; it has stopped seeing the API`);
  assertEquals(missingPolicies(readPolicies()), []);
});

Deno.test("QA-B225/QA-B229: the guard catches the 9 Nov check-in save failure without 0047", () => {
  const miss = missingPolicies(readPolicies((n) => n.startsWith("0047_")));
  assert(miss.some((m) => m.startsWith("checkin.ts:") && m.includes("no insert policy on check_ins")), miss.join("\n"));
  assert(miss.some((m) => m.includes("no insert policy on check_in_dates")), miss.join("\n"));
});

Deno.test("the guard catches the later one of the same class: without 0048 it names parked_notes", () => {
  const miss = missingPolicies(readPolicies((n) => n.startsWith("0048_")));
  assert(miss.some((m) => m.includes("no insert policy on parked_notes")), miss.join("\n"));
});
