// Linux-safe tests for POST /feedback (COO 12:30 10-31, tester report intake): the screenshot checks and
// that the route needs no built-in bearer (it validates a bearer or the tester token itself).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { decodeBase64, isEmptyJpegBase64, isJpeg, MAX_SCREENSHOT_BYTES } from "../api/feedback.ts";
import { routes } from "../api/lib/router.ts";
import "../api/index.ts";

function jpegBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0xff; b[1] = 0xd8; b[size - 2] = 0xff; b[size - 1] = 0xd9;
  return b;
}

Deno.test("isJpeg: the start-of-image and end-of-image markers only; too short never passes", () => {
  assertEquals(isJpeg(jpegBytes(10)), true);
  assertEquals(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);   // a PNG signature
  assertEquals(isJpeg(new Uint8Array([0xff, 0xd8])), false);               // no room for an end marker
  assertEquals(isJpeg(new Uint8Array(0)), false);
});

Deno.test("decodeBase64 round-trips what btoa encoded; bad input throws", () => {
  const bytes = jpegBytes(16);
  const b64 = btoa(String.fromCharCode(...bytes));
  assertEquals(decodeBase64(b64), bytes);
  let threw = false;
  try { decodeBase64("not base64 at all!!"); } catch { threw = true; }
  assert(threw);
});

Deno.test("the 2 MB screenshot cap matches the migration's storage bucket file_size_limit", () => {
  assertEquals(MAX_SCREENSHOT_BYTES, 2 * 1024 * 1024);
});

Deno.test("POST /feedback is registered and does not require the router's own bearer (it checks auth or the tester token itself)", () => {
  const r = routes.find((x) => x.method === "POST" && x.pattern.test("/feedback"));
  assert(r, "POST /feedback");
  assertEquals(r.auth, false);
});

Deno.test("a missing, empty or blank screenshot counts as left out (v1.71); a real one does not", () => {
  assertEquals(isEmptyJpegBase64(""), true);
  assertEquals(isEmptyJpegBase64("  \n"), true);
  assertEquals(isEmptyJpegBase64(btoa(String.fromCharCode(...jpegBytes(8)))), false);
});
