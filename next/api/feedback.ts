// POST /feedback (COO 12:30 10-31, tester report intake): a signed-in account's bearer, or a shared
// tester token for testers with no account, submits a JSON report plus a screenshot. Idempotent on the
// client's `report_id`: resubmitting the same id replaces the row and the stored image, never duplicates it.
import { ApiError, json } from "./lib/errors.ts";
import { authenticate, dbError } from "./lib/db.ts";
import { route } from "./lib/router.ts";
import { secretEquals } from "./lib/secret.ts";

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MB

export function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Base64 of zero bytes is the empty string; whitespace-only counts as left out too. */
export function isEmptyJpegBase64(s: string): boolean {
  return s.trim() === "";
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

route("POST", "/feedback", async (ctx) => {
  const { env, req, service } = ctx;
  let reporterId: string | null = null;
  if (req.headers.get("authorization")) {
    reporterId = (await authenticate(env, req)).id;
  } else {
    const supplied = req.headers.get("x-presence-tester-token") ?? "";
    if (!env.testerToken || !(await secretEquals(supplied, env.testerToken))) throw new ApiError("unauthorized", "Sign in to continue.");
  }

  const b = await ctx.body();
  const reportId = String(b.report_id ?? "").trim();
  if (!reportId) throw new ApiError("invalid", "", { field: "report_id" });
  const reportBody = b.body;
  if (!reportBody || typeof reportBody !== "object" || Array.isArray(reportBody)) throw new ApiError("invalid", "", { field: "body" });
  // The screenshot is optional (v1.71): a report with the shot left out (another person's words on screen,
  // or the switch off) carries nothing, an empty string, or null. A present value is still checked.
  const screenshotBase64 = typeof b.screenshot_base64 === "string" ? b.screenshot_base64 : "";
  let path: string | null = null;
  if (screenshotBase64 && !isEmptyJpegBase64(screenshotBase64)) {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(screenshotBase64);
    } catch {
      throw new ApiError("invalid", "Screenshot could not be decoded.", { field: "screenshot_base64" });
    }
    if (bytes.length > MAX_SCREENSHOT_BYTES) throw new ApiError("invalid", "Screenshot must be 2 MB or smaller.", { field: "screenshot_base64" });
    if (!isJpeg(bytes)) throw new ApiError("invalid", "Screenshot must be a JPEG.", { field: "screenshot_base64" });
    path = `${reporterId ?? "tester"}/${reportId}.jpg`;
    const uploaded = await service.storage.from("feedback").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (uploaded.error) throw new ApiError("internal", "", { detail: uploaded.error.message });
  }

  const { data, error } = await service.from("feedback")
    .upsert({ report_id: reportId, reporter: reporterId, body: reportBody, screenshot_path: path }, { onConflict: "report_id" })
    .select("id, report_id, created_at")
    .single();
  if (error) dbError(error, "feedback");
  return json({ feedback: { id: data.id, report_id: data.report_id, created_at: data.created_at } });
}, false);
