import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ApiError } from "../api/lib/errors.ts";
import { IMPORT_PROVIDER, importPlacement, requireImportProviderDisclosure } from "../api/import_ai.ts";
import { discardedImportGuessIds } from "../engine/import_ai.ts";

Deno.test("TQ4: only explicitly rated cards retain de-identified import receipt rows", () => {
  const all = ["very", "partly", "not", "not-sure", "unanswered"];
  assertEquals(discardedImportGuessIds(all, ["very", "partly", "not"]), ["not-sure", "unanswered"]);
});

Deno.test("TQ4: imported core waits at reaction level until a Talk receipt", () => {
  assertEquals(importPlacement("something I believe is true"), {
    kind: "everyday",
    level: "L4",
    pending_level: "L0",
  });
  assertEquals(importPlacement("a rule I live by"), { kind: "rule", level: "L1", pending_level: null });
});

Deno.test("TQ4: schema persists no raw pasted text and Talk evidence promotes deferred core", async () => {
  const [initial, retention] = await Promise.all([
    Deno.readTextFile("../supabase/migrations/0017_ai_import.sql"),
    Deno.readTextFile("../supabase/migrations/0021_ai_import_retention.sql"),
  ]);
  const importsTable = initial.slice(
    initial.indexOf("create table if not exists public.ai_imports"),
    initial.indexOf("create table if not exists public.ai_import_guesses"),
  );
  for (const rawColumn of ["raw_text", "pasted_text", "content", "source_text"]) {
    assertEquals(importsTable.includes(rawColumn), false);
  }
  assert(retention.includes("after insert on public.receipts"));
  assert(retention.includes("and source = 'import'"));
  assert(retention.includes("pending_level = null"));
});

Deno.test("R13: import accepts evidence of the one-time named-provider disclosure", () => {
  requireImportProviderDisclosure({
    provider_disclosure: { provider: IMPORT_PROVIDER, disclosed_at: "2026-11-01T08:00:00.000Z" },
  });

  for (
    const body of [
      { text: "fictional answer" },
      { provider_disclosure: true },
      { provider_disclosure: { provider: IMPORT_PROVIDER } },
      { provider_disclosure: { provider: IMPORT_PROVIDER, disclosed_at: "not-a-time" } },
      { provider_disclosure: { provider: "openai", disclosed_at: "2026-11-01T08:00:00.000Z" } },
    ]
  ) {
    const error = assertThrows(() => requireImportProviderDisclosure(body), ApiError);
    assertEquals(error.code, "forbidden");
    assertEquals(error.extra, {
      reason: "import_provider_disclosure_required",
      provider: IMPORT_PROVIDER,
    });
  }
});
