// Issue #12. Acceptance test written in C4 from packages/01 (compliance.md first row, copy.md `aiConsent`) only.
// The served page at /privacy names Anthropic as the third-party AI provider, says which data is sent and which is not,
// and makes no claim that contradicts the `aiConsent` copy.
//
// API the tests expect:
// - `site/_worker.js` serves `https://kenember.com/privacy` (and `/privacy/`) from its static assets (`env.ASSETS`),
//   as Cloudflare Pages does: the request path maps to `site/privacy/index.html`. The test gives the worker an ASSETS
//   binding that reads the real files under `site/`.
// - The page is HTML; the test reads its visible text (tags, scripts and styles removed, entities decoded).
import { assert, assertEquals } from "jsr:@std/assert@1";

async function repoRoot(): Promise<URL> {
  let dir = new URL("./", import.meta.url);
  for (let i = 0; i < 8; i++) {
    try {
      await Deno.stat(new URL("AGENTS.md", dir));
      return dir;
    } catch { dir = new URL("../", dir); }
  }
  throw new Error("repository root (AGENTS.md) not found above " + import.meta.url);
}

async function served(path: string): Promise<{ status: number; text: string }> {
  const root = await repoRoot();
  const site = new URL("site/", root);
  const ASSETS = {
    async fetch(req: Request) {
      let p = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      if (p.includes("..")) return new Response("no", { status: 400 });
      if (p === "" || p.endsWith("/")) p += "index.html";
      for (const candidate of [p, `${p}/index.html`, `${p}.html`]) {
        try {
          const body = await Deno.readTextFile(new URL(candidate, site));
          return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        } catch { /* next */ }
      }
      return new Response("not found", { status: 404 });
    },
  };
  const worker = (await import(new URL("site/_worker.js", root).href)).default as {
    fetch: (r: Request, env: unknown) => Promise<Response>;
  };
  const env = { API_ORIGIN: "https://api.invalid", API_ANON_KEY: "anon", ASSETS };
  const res = await worker.fetch(new Request("https://kenember.com" + path), env);
  return { status: res.status, text: await res.text() };
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);
const NEGATION = /\b(no|not|never|none|nor|without)\b|n't\b/i;

Deno.test("#12 /privacy is served", async () => {
  for (const path of ["/privacy", "/privacy/"]) {
    const { status } = await served(path);
    assertEquals(status, 200, `${path} answered ${status}`);
  }
});

Deno.test("#12 the page names Anthropic as the third-party AI provider, and Claude", async () => {
  const text = visibleText((await served("/privacy")).text);
  assert(/\bAnthropic\b/.test(text), "Anthropic is not named");
  assert(/\bClaude\b/.test(text), "Claude (the model the aiConsent copy names) is not named");
  const named = sentences(text).filter((s) => /\bAnthropic\b/.test(s));
  assert(named.some((s) => /\b(words|messages|text|what you (write|say|type))\b/i.test(s)),
    "no sentence says that your words go to Anthropic");
});

Deno.test("#12 the page says what is sent: your words when you talk or write, so Kenember can reply and offer notes", async () => {
  const text = visibleText((await served("/privacy")).text);
  assert(/\btalk\b/i.test(text) && /\bwrit(e|ing)\b/i.test(text), "Talk and writing are not both named as what sends words");
});

Deno.test("#12 the page says what is not done: no training, no selling, no ads, no audio sent", async () => {
  const text = visibleText((await served("/privacy")).text);
  const lines = sentences(text);
  const says = (topic: RegExp) => lines.some((s) => topic.test(s) && NEGATION.test(s));
  assert(says(/\btrain(s|ed|ing)?\b/i), "no line says your words are never used to train AI");
  assert(says(/\bsell(s|ing)?\b|\bsold\b/i), "no line says your words are never sold");
  assert(says(/\b(ads|advertis(ing|ement|ements|ers)?)\b/i), "no line says your words are never used for ads");
  assert(lines.some((s) => /\b(audio|speech|voice)\b/i.test(s) && (NEGATION.test(s) || /\bon (this|your) (iPhone|device|phone)\b/i.test(s))),
    "no line says speech becomes text on the iPhone and no audio is sent");
});

Deno.test("#12 the page says consent can be turned off in Settings", async () => {
  const text = visibleText((await served("/privacy")).text);
  assert(sentences(text).some((s) => /\bSettings\b/.test(s) && /\b(off|withdraw)\b/i.test(s)),
    "no line says the AI can be turned off in Settings");
});

Deno.test("#12 no claim on the page contradicts the aiConsent copy", async () => {
  const text = visibleText((await served("/privacy")).text);
  const problems: string[] = [];
  // Anthropic is the only AI provider (copy: "your words go to Anthropic's Claude"; CONTRACT §11.4 providers ["anthropic"]).
  for (const other of [/\bOpenAI\b/, /\bChatGPT\b/, /\bGemini\b/, /\bMistral\b/, /\bCohere\b/, /\bLlama\b/, /\bCopilot\b/]) {
    if (other.test(text)) problems.push(`names another AI provider: ${other.source}`);
  }
  for (const s of sentences(text)) {
    // Every sentence about training, selling, ads or audio being sent must be a denial.
    if (/\btrain(s|ed|ing)?\b/i.test(s) && /\b(AI|model|models)\b/i.test(s) && !NEGATION.test(s)) {
      problems.push(`claims training: "${s}"`);
    }
    if (/\b(sell|sells|sold|selling)\b/i.test(s) && !NEGATION.test(s)) problems.push(`claims selling: "${s}"`);
    if (/\b(ads|advertising|advertisers)\b/i.test(s) && !NEGATION.test(s)) problems.push(`claims ads: "${s}"`);
    if (/\b(audio|recordings?)\b/i.test(s) && /\b(sent|send|upload(s|ed)?|stor(e|ed|es))\b/i.test(s) && !NEGATION.test(s)) {
      problems.push(`claims audio leaves the phone: "${s}"`);
    }
  }
  assertEquals(problems, []);
});
