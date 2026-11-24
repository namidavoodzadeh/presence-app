// Regression for 20261028-bridge-sonnet-aq21 b06: both rewrites failed because the
// character rule required behaviour that the sender's words never supplied.

import { assertStringIncludes } from "jsr:@std/assert@1";
import { REWRITE_PROMPT, VERIFY_PROMPT } from "../engine/bridge/bridge.ts";
import { MENU } from "../engine/bridge/plan.ts";

Deno.test("b06 label-only character rule keeps the complaint without inventing behaviour", () => {
  assertStringIncludes(MENU.character, "if the words name no behaviour");
  assertStringIncludes(MENU.character, "recast the label as the sender's experience");
  assertStringIncludes(REWRITE_PROMPT, "When the original gives only the label, do not invent a behaviour");
  assertStringIncludes(REWRITE_PROMPT, "With the kitchen, it feels like I'm being controlled");
  assertStringIncludes(VERIFY_PROMPT, "If the original gives only the label");
  assertStringIncludes(VERIFY_PROMPT, "an invented behaviour still fails");
});
