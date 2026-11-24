// Not built or run anywhere (see README.md). Translation of next/engine/safety.ts's
// RiskResult into the FoundationModels @Generable shape, for the model-side half of the
// safety screen only — the keyword floor (next/engine/safety.ts keywordRisk) stays as the
// fast, non-model first check on both paths; the model can add a stop, never remove one
// (next/engine/safety.ts combinedRisk).

import FoundationModels

@Generable
enum Risk: String { case none, selfRisk = "self", others }

@Generable
struct RiskClassification {
    var risk: Risk
    @Guide(description: "A few words, the reason for the risk level, or empty when none.")
    var reason: String
}

// Expected session call shape for a future device-capable run:
//
//   let session = LanguageModelSession(guardrails: .default)
//   do {
//     let reply = try await session.respond(to: personText, generating: RiskClassification.self)
//   } catch LanguageModelError.guardrailViolation, LanguageModelError.refusal {
//     // Apple's own on-device guardrail intercepted the text before classification ran.
//     // Record this itself as a stop (risk: "self", reason: "model refusal") rather than
//     // treating it as "none" — law 8 ("safety overrides everything") means a refusal on
//     // self-harm text is a signal, not a null result. See outputs/engine/FOUNDATION-MODELS.md.
//   }
