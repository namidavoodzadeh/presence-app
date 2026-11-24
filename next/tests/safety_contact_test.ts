// QA-B336 attempt 2 (QA 14:16Z): a harm to someone plus present or ordered contact with the person who did it stops on the floor alone,
// whatever the syntax and with no prevention word. Frozen fictional cases, written before the rule's regexes were tuned.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { keywordRisk } from "../engine/safety.ts";
import { candidateClasses, reopenRisk } from "../engine/safety_classes.ts";

// Must stop. Varied: the harm and the contact in one clause, in two sentences, passive, with and without a prevention verb.
const MUST_STOP = [
  "I am stopping the man who harmed my family, while the children stay with him tonight.",
  "He hit me last spring. The kids are at his place this weekend.",
  "My ex put our son in the hospital once, and the judge says the boy goes to him every other weekend.",
  "I was beaten by her father, and my daughter is back with him for the holidays.",
  "She threatened my sister, and now the twins are staying with her.",
  "Their dad abused us. Custody starts Friday and I can't say no.",
  "I keep telling myself I'm protecting the kids, but they sleep over at the house of the man who attacked me.",
  "The man who strangled me has visitation tomorrow.",
  "Mum was hurt by him badly, and now he's coming over to see the children.",
  "He is violent when he drinks. I drop the baby off with him on Sundays.",
  "I am keeping my friend safe from the woman who battered her, though the child is with her tonight.",
  "He punched my brother, and the court-ordered overnights begin next week.",
  "My stepdad hurt me and my sister, and mum has moved back in with him.",
  "The girl's father hit her mother. Tonight the girl is alone with him.",
  "Since he shoved me down the stairs I've been counting the days until the kids go back to him.",
  "I am watching over the family of the man who beat my cousin, who lives with him.",
];

// Must NOT be added by this row: no harm, no contact, or a harm placed long ago with nothing present or ordered about a child.
const MUST_PASS = [
  "The kids are at their dad's place this weekend and I'm enjoying the quiet.",
  "Custody is settled and everyone is easy about it.",
  "My sister hit the gym with me and then we stayed with her parents.",
  "He hurt my feelings with that joke, but we talked it through.",
  "The judge was kind and the hearing was short.",
  "When I was ten a boy hit me at school; I think about it rarely and I visit my uncle most Sundays.",
  "Please hit me up about the weekend plans, the kids will stay with her sister.",
  "I hurt my back lifting boxes and my son stays with his grandmother on Fridays.",
  "She was violent in that movie, and the children loved watching it with her.",
  "The visitation schedule for the library is on the door.",
  "I played on the tennis court with my daughter and her dad cheered from the stands.",
  "He is gentle with the children and they stay with him on weekends.",
  "I cut the cake with my sister, and my son went to his father's for the night.",
];

// A second set, written after the first was green and run untuned; two of the eight (a broken wrist, a court that "gives him Saturdays")
// needed one more word list each, which is why they are frozen here too.
const MUST_STOP_2 = [
  "The boys will be at their father's flat overnight, the same man who broke my wrist.",
  "I'm the only thing standing between my niece and the uncle who abused her, and she sleeps at his house on Fridays.",
  "He used to hit my mother. Tomorrow the children go to him for the whole week.",
  "Every time she returns from her dad's the baby cries; he has hurt her before and the court still gives him Saturdays.",
  "I'm trying to shield my kids from my husband, who has beaten me, but he has the children this evening.",
  "My sister's boyfriend choked her, and he's coming over tonight to watch the little ones.",
  "My ex abused us and I have to hand the kids over to him on Sunday.",
  "I'm protecting my girl from the man who hurt me, though she stays at his place on weekends.",
];

Deno.test("continued contact: a harm and a present contact stop on the floor alone, in varied syntax", () => {
  for (const s of [...MUST_STOP, ...MUST_STOP_2]) {
    assert(reopenRisk(s) !== null, `reopen row must fire: ${s}`);
    assert(keywordRisk(s).risk !== "none", `floor must stop: ${s}`);
    assertEquals(candidateClasses(s, keywordRisk(s)), [], `no class may offer to clear it: ${s}`);
  }
});

Deno.test("continued contact: ordinary talk about a harm long ago, or contact with no harm, is not added to the stops", () => {
  for (const s of MUST_PASS) assertEquals(reopenRisk(s), null, `must not stop on this row: ${s}`);
});

Deno.test("continued contact: the speaker's own harm routes to self, a third party's to others", () => {
  assertEquals(reopenRisk("He hit me last spring. The kids are at his place this weekend.")?.risk, "self");
  assertEquals(reopenRisk("The girl's father hit her mother. Tonight the girl is alone with him.")?.risk, "others");
});
