// A pure text check shared by the map and Ask me. Lives apart from ask_me.ts so the map does not import the Ask me module
// (the friends' configuration proof in tests/safety_entry_test.ts: no importer of lib/ask_me.ts in api/ or engine/). No model call.
const HARSH_SELF = /\b(not\s+enough|worthless|failure|burden|hate\s+myself|unlovable|broken|do(?:n'?t|\s+not)\s+matter|useless)\b/i;
export const isHarshSelfStatement = (text: string): boolean => HARSH_SELF.test(text);
