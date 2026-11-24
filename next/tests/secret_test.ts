// Dependency-free on purpose (no jsr:@std imports) so it also runs where jsr.io is unreachable.
import { secretEquals } from "../api/lib/secret.ts";

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

Deno.test("secretEquals: equal strings match", async () => {
  check(await secretEquals("tester-token-123", "tester-token-123"), "equal strings must match");
});

Deno.test("secretEquals: unequal strings of the same length do not match", async () => {
  check(!(await secretEquals("tester-token-123", "tester-token-124")), "same-length unequal must not match");
  check(!(await secretEquals("Xester-token-123", "tester-token-123")), "first-byte difference must not match");
});

Deno.test("secretEquals: strings of different length do not match", async () => {
  check(!(await secretEquals("tester-token", "tester-token-123")), "prefix must not match");
  check(!(await secretEquals("tester-token-1234", "tester-token-123")), "longer must not match");
});

Deno.test("secretEquals: empty inputs", async () => {
  check(await secretEquals("", ""), "empty equals empty in the helper; callers refuse an unset secret first");
  check(!(await secretEquals("", "tester-token-123")), "empty supplied must not match a set secret");
  check(!(await secretEquals("tester-token-123", "")), "set supplied must not match an empty expected");
});
