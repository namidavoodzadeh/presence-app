import { assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { streamErrorPayload } from "../api/talk.ts";
import { ApiError } from "../api/lib/errors.ts";

class ErrorRows {
  readonly rows: Record<string, unknown>[] = [];

  client(): SupabaseClient {
    const rows = this.rows;
    return {
      from(table: string) {
        assertEquals(table, "errors");
        return {
          insert(row: Record<string, unknown>) {
            rows.push(row);
            return {
              select(column: string) {
                assertEquals(column, "ref");
                return {
                  single() {
                    return Promise.resolve({ data: { ref: "7F3K" }, error: null });
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;
  }
}

Deno.test("E7 stream daily_limit keeps its public fields and records the same code", async () => {
  const store = new ErrorRows();
  const payload = await streamErrorPayload(
    store.client(),
    "fictional-person",
    new ApiError("daily_limit", "Talk opens again tomorrow.", {
      opens_at: "2026-11-05T00:00:00.000Z",
      scope: "talk",
      saved: true,
      message_id: "fictional-message",
      detail: "private ledger diagnostic",
    }),
  );

  assertEquals(payload, {
    error: "daily_limit",
    ref: "7F3K",
    message: "Talk opens again tomorrow.",
    opens_at: "2026-11-05T00:00:00.000Z",
    scope: "talk",
    saved: true,
    message_id: "fictional-message",
  });
  assertFalse("detail" in payload);
  assertEquals(store.rows[0].code, "daily_limit");
});

Deno.test("E7 stream unexpected failure is internal in both event and errors row", async () => {
  const store = new ErrorRows();
  const payload = await streamErrorPayload(
    store.client(),
    "fictional-person",
    new Error("fictional failure"),
  );

  assertEquals(payload, { error: "internal", ref: "7F3K", message: "internal" });
  assertEquals(store.rows[0].code, "internal");
  assertEquals(store.rows[0].detail, "internal | Error: fictional failure");
});
