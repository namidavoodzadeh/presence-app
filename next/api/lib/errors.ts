// Every error reply is `{error, ref, message?, ...extra}` (CONTRACT §0) and one row in `errors`.
// Nothing in a user-facing path throws past the router: ApiError becomes a reply; anything else becomes `internal`.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ErrorCode =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "sealed"
  | "not_found"
  | "conflict"
  | "daily_limit"
  | "rate_limited"
  | "ai_off"
  | "engine_failed"
  | "unreachable"
  | "internal";

export const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  sealed: 403,
  not_found: 404,
  conflict: 409,
  daily_limit: 429,
  rate_limited: 429,
  ai_off: 503,
  engine_failed: 502,
  unreachable: 503,
  internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly extra: Record<string, unknown>;
  constructor(code: ErrorCode, message = "", extra: Record<string, unknown> = {}) {
    super(message || code);
    this.code = code;
    this.extra = extra;
  }
}

/** Record the error and return its 4-character Ref. The service client bypasses RLS; the table has no user policy. */
export async function recordError(
  service: SupabaseClient,
  person: string | null,
  where: string,
  code: string,
  detail: string,
): Promise<string> {
  try {
    const { data, error } = await service.from("errors").insert({
      person,
      where_: where,
      code,
      detail: detail.slice(0, 2000),
    }).select("ref").single();
    if (!error && data?.ref) return data.ref as string;
  } catch { /* fall through */ }
  // The database itself is unreachable: a local Ref so the screenshot still carries one; it is logged, not stored.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "";
  for (let i = 0; i < 4; i++) ref += alphabet[Math.floor(Math.random() * alphabet.length)];
  console.error(`errors row not written; local ref ${ref} ${where} ${code}: ${detail.slice(0, 300)}`);
  return ref;
}

const REF = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/** The Refs a client may report in one `X-Client-Ref` header (comma- or space-separated), at most eight, each four characters of the Ref alphabet. */
export function clientRefs(header: string | null): string[] {
  if (!header) return [];
  return [...new Set(header.toUpperCase().split(/[\s,]+/).filter((r) => REF.test(r)))].slice(0, 8);
}

/**
 * A Ref the phone made itself (S05: Presence never answered, so no server row exists) arrives on the next request and is kept in
 * `errors` with source "client", so the owner's screenshot can still be looked up. The client's Ref is the row's Ref when it is free;
 * otherwise the row takes a new Ref and `client_ref` carries the phone's. Never fails the request.
 */
export async function recordClientRefs(
  service: SupabaseClient,
  person: string | null,
  where: string,
  header: string | null,
): Promise<string[]> {
  const refs = clientRefs(header);
  const kept: string[] = [];
  for (const ref of refs) {
    try {
      const row = {
        person,
        where_: where,
        code: "client_reported",
        source: "client",
        client_ref: ref,
        detail: "Ref made on the phone; Presence did not answer that request.",
      };
      const { error } = await service.from("errors").insert({ ...row, ref });
      if (!error) {
        kept.push(ref);
        continue;
      }
      const { error: e2 } = await service.from("errors").insert(row); // the Ref was taken: a fresh server Ref, the phone's kept beside it
      if (!e2) kept.push(ref);
      else console.error(`client ref ${ref} not recorded: ${e2.message}`);
    } catch (e) {
      console.error(`client ref ${ref} not recorded: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return kept;
}

export function errorReply(
  code: ErrorCode,
  ref: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error: code, ref, message: message || undefined, ...extra }, STATUS[code]);
}

// CONTRACT §0: times are ISO 8601 in UTC with `Z` and milliseconds. Postgres hands rows back as `2026-10-27T09:14:22.06097+00:00`
// (an offset, five fractional digits) or `2026-10-27 16:30:00+00` in error details, so every time field is normalised on the way out.
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d{1,9})?\s*(Z|[+-]\d{2}(?::?\d{2})?)$/i;
const TIME_KEY = /(?:^|_)(?:at|until|since|when)$/;

/** `2026-10-27T09:14:22.06097+00:00` → `2026-10-27T09:14:22.060Z`. Anything that is not a timestamp comes back unchanged. */
export function isoUtc(value: string): string {
  const m = TIMESTAMP.exec(value.trim());
  if (!m) return value;
  const millis = (m[3] ?? ".000").slice(0, 4).padEnd(4, "0");
  let offset = m[4].toUpperCase();
  if (offset !== "Z") {
    offset = offset.length === 3
      ? `${offset}:00`
      : offset.length === 5
      ? `${offset.slice(0, 3)}:${offset.slice(3)}`
      : offset;
  }
  const d = new Date(`${m[1]}T${m[2]}${millis}${offset}`);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** The JSON.stringify replacer: time fields (`*_at`, `*_until`, `at`, `since`, `when`) carrying a timestamp are normalised; text is never touched. */
export function normaliseTimes(key: string, value: unknown): unknown {
  return typeof value === "string" && TIME_KEY.test(key) ? isoUtc(value) : value;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, normaliseTimes), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-presence-contract": "1", ...headers },
  });
}
