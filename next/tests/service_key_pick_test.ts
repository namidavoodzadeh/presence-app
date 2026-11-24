// Rotation (outputs/engine/ROTATION.md): which server-side key the API uses. $0.
import { assertEquals } from "jsr:@std/assert@1";
import { pickServiceKey } from "../api/lib/env.ts";

const MAP = JSON.stringify({ default: "sb_secret_default", rotated: "sb_secret_rotated" });

Deno.test("pickServiceKey: our own secret wins, then the named map entry, then the legacy key", () => {
  assertEquals(pickServiceKey("sb_secret_own", MAP, "rotated", "legacy"), "sb_secret_own");
  assertEquals(pickServiceKey("", MAP, "rotated", "legacy"), "sb_secret_rotated");
  assertEquals(pickServiceKey("  ", MAP, "", "legacy"), "legacy", "the map is used only when a name is set: no surprise switch");
});

Deno.test("pickServiceKey: an unreadable map, a missing name or a non-string entry falls back to the legacy key, never throws", () => {
  assertEquals(pickServiceKey("", "not json", "rotated", "legacy"), "legacy");
  assertEquals(pickServiceKey("", MAP, "gone", "legacy"), "legacy");
  assertEquals(pickServiceKey("", JSON.stringify({ rotated: 5 }), "rotated", "legacy"), "legacy");
  assertEquals(pickServiceKey("", "", "rotated", "legacy"), "legacy");
});
