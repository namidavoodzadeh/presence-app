// Nami's hand-test pair "kai" and "noor" (COO 13:50 10-31, CONTRACT v1.23) belongs to his hand testing
// only: no check, smoke or harness script may sign in as either persona. A hardcoded "kai"/"noor"
// literal anywhere else under api/, scripts/ or engine/ is this test's failure.
import { assertEquals } from "jsr:@std/assert@1";

const ALLOWED = new Set([
  "api/lib/objects.ts",      // PERSONAS: the only place the slugs are a valid login value
  "scripts/seed_preview.py", // seeds the pair
  "tests/kai_noor_test.ts",  // this test
]);

const FORBIDDEN = /\b(kai|noor)\b/i;
const SCAN_EXT = [".ts", ".py"];
const SCAN_DIRS = ["api", "scripts", "engine"];

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "reports" || entry.name === "node_modules") continue;
      yield* walk(path);
    } else if (SCAN_EXT.some((ext) => entry.name.endsWith(ext))) {
      yield path;
    }
  }
}

Deno.test("no check, smoke or harness script signs in as kai or noor", async () => {
  const root = new URL("..", import.meta.url).pathname;
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for await (const path of walk(root + dir)) {
      const rel = path.slice(root.length);
      if (ALLOWED.has(rel)) continue;
      const text = await Deno.readTextFile(path);
      if (FORBIDDEN.test(text)) offenders.push(rel);
    }
  }
  assertEquals(offenders, [], `kai/noor is Nami's hand-test pair only, never used by test tooling: ${offenders.join(", ")}`);
});
