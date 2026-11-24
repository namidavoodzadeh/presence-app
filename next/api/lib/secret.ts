// Constant-time comparison for shared secrets (tester token, push-drain secret).
// Both sides are hashed with SHA-256 first, so the byte loop always runs over 32 bytes and neither the
// position of the first differing byte nor the secret's length is revealed through timing.

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** True when `supplied` equals `expected`. Callers still refuse on their own when `expected` is unset. */
export async function secretEquals(supplied: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(supplied), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
