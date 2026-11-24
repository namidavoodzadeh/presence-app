// The generated prompt module must match the prompt files (next/scripts/gen_prompts.ts), or the hosted function would run old prompts.
import { assertEquals } from "jsr:@std/assert@1";
import { OUT, render } from "../scripts/gen_prompts.ts";

Deno.test("engine/prompt_text.ts is generated from the current prompt files", async () => {
  const have = await Deno.readTextFile(new URL(`../${OUT}`, import.meta.url));
  assertEquals(have, await render(), `run: deno task prompts`);
});
