// The ledger interface the model client calls around every paid request: reserve the worst case before the call, settle the
// measured cost after it. A refusal means no call is made. The live adapter is PostgresLedger (next/api/lib/ledger.ts, the
// `usage_ledger` table shared with the app's API); the SQLite adapter over daily_admission.py was retired on 2026-10-27 (A59).

/** A safety reading (purpose "safety", engine/safety_semantic.ts) is written under its own ledger kind: it is not counted against a
 *  person's daily allowance or the shared day cap, and one global daily ceiling bounds it (migration 0073). */
export const SAFETY_PURPOSE = "safety";
export const SAFETY_LEDGER_KIND = "safety_read";

export interface Admission { ok: boolean; error?: string }

export interface Ledger {
  reserve(nonce: string, kind: string, worstCents: number): Promise<Admission>;
  settle(nonce: string, spentCents: number, receipt: string | null, model: string): Promise<void>;
}

/** $0 runs (unit tests, recorded replays) never touch the ledger. */
export class NoopLedger implements Ledger {
  reserve(): Promise<Admission> { return Promise.resolve({ ok: true }); }
  settle(): Promise<void> { return Promise.resolve(); }
}
