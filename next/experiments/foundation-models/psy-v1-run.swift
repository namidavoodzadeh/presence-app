import Foundation
import FoundationModels

@Generable
struct PsyItems {
    @Guide(description: "Each complete MOMENT item, in source order. Copy its body exactly, joining its four fields with ' | '.", .maximumCount(8))
    var moments: [String]
    @Guide(description: "Each THEME value exactly as written, in source order.", .maximumCount(4))
    var themes: [String]
    @Guide(description: "Each RULE value exactly as written, in source order.", .maximumCount(4))
    var rules: [String]
    @Guide(description: "Each PATTERN value exactly as written, in source order.", .maximumCount(4))
    var patterns: [String]
    @Guide(description: "Each MATTERS value exactly as written, in source order.", .maximumCount(4))
    var matters: [String]
}

struct Fixture: Decodable { let id: String; let fictional: Bool; let text: String }

func clean(_ line: String) -> String {
    line.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"^#{1,6}\s*"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: #"^[-*]\s+"#, with: "", options: .regularExpression)
        .replacingOccurrences(of: "**", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func field(_ line: String) -> (String, String)? {
    let s = clean(line)
    guard let r = s.range(of: #"^([A-Za-z ]+?)(?:\s+\d+)?\s*:\s*(.*)$"#, options: .regularExpression) else { return nil }
    let whole = String(s[r])
    guard let colon = whole.firstIndex(of: ":") else { return nil }
    let left = whole[..<colon].replacingOccurrences(of: #"\s+\d+$"#, with: "", options: .regularExpression)
    return (left.uppercased().trimmingCharacters(in: .whitespaces), String(whole[whole.index(after: colon)...]).trimmingCharacters(in: .whitespaces))
}

func reference(_ raw: String) -> [String: [String]] {
    let lines = raw.components(separatedBy: .newlines).map(clean).filter { !$0.isEmpty }
    var out = ["moments": [String](), "themes": [String](), "rules": [String](), "patterns": [String](), "matters": [String]()] 
    var moment: [String] = []
    func key(_ heading: String) -> String {
        heading == "MATTERS" ? "matters" : heading.lowercased() + "s"
    }
    func flushMoment() { if moment.count == 4 { out["moments", default: []].append(moment.joined(separator: " | ")) }; moment.removeAll() }
    for line in lines.dropFirst() {
        guard let (name, value) = field(line) else { continue }
        if name == "MOMENT" { flushMoment(); continue }
        if ["WHAT HAPPENED", "WHAT YOU DID OR SAID", "YOUR WORDS", "AREA"].contains(name), !value.isEmpty { moment.append(value); continue }
        if ["THEME", "RULE", "PATTERN", "MATTERS"].contains(name) { flushMoment(); out[key(name), default: []].append(value) }
    }
    flushMoment()
    return out
}

func prefixCharacterCountThatFits(_ text: String, model: SystemLanguageModel, limit: Int) async -> Int {
    var low = 0, high = text.count
    while low < high {
        let mid = (low + high + 1) / 2
        let prefix = String(text.prefix(mid))
        let count = (try? await model.tokenCount(for: Prompt(prefix))) ?? limit + 1
        if count <= limit { low = mid } else { high = mid - 1 }
    }
    return low
}

let fixturesURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: fixturesURL))
let model = SystemLanguageModel.default
print("availability=\(model.availability) context=\(model.contextSize)")
guard model.isAvailable else { exit(2) }

let instruction = """
Split a PSY v1 answer into its labelled items. Do not interpret, rewrite, merge, omit, or add text. Ignore KNOWS ME and Seen lines. For a MOMENT, join the values of What happened, What you did or said, Your words, and Area with exactly ' | '. Return the five arrays in source order.
"""
var rows: [[String: Any]] = []
for fixture in fixtures {
    let ref = reference(fixture.text)
    let prompt = instruction + "\n\nPSY V1 ANSWER:\n" + fixture.text
    let inputTokens = try await model.tokenCount(for: Prompt(prompt))
    let requestedWindow = 4_096
    let fitChars = await prefixCharacterCountThatFits(prompt, model: model, limit: requestedWindow)
    let start = ContinuousClock.now
    var row: [String: Any] = [
        "id": fixture.id, "fictional": fixture.fictional, "characters": fixture.text.count,
        "words": fixture.text.split(whereSeparator: \ .isWhitespace).count,
        "inputTokens": inputTokens, "contextWindow": model.contextSize,
        "inputHeadroomTokens": model.contextSize - inputTokens,
        "requestedWindow": requestedWindow,
        "inputHeadroomAt4096": requestedWindow - inputTokens,
        "inputTruncates": fitChars < prompt.count,
        "truncationCharacter": fitChars < prompt.count ? fitChars : NSNull(),
        "reference": ref,
    ]
    do {
        let session = LanguageModelSession(model: model, instructions: "You are a literal structured-text parser.")
        let reply = try await session.respond(to: Prompt(prompt), generating: PsyItems.self, options: GenerationOptions(sampling: .greedy))
        let got = ["moments": reply.content.moments, "themes": reply.content.themes, "rules": reply.content.rules, "patterns": reply.content.patterns, "matters": reply.content.matters]
        var matches: [String: Any] = [:]
        for kind in ["moments", "themes", "rules", "patterns", "matters"] {
            let expected = ref[kind] ?? [], actual = got[kind] ?? []
            matches[kind] = ["expected": expected.count, "actual": actual.count, "exact": zip(expected, actual).filter(==).count, "allExact": expected == actual]
        }
        row["status"] = "ok"
        row["apple"] = got
        row["match"] = matches
        row["allItemsExact"] = ref == got
        let rendered = String(data: try JSONSerialization.data(withJSONObject: got, options: [.sortedKeys]), encoding: .utf8)!
        let outputTokens = try await model.tokenCount(for: Prompt(rendered))
        row["outputTokens"] = outputTokens
        row["totalTokens"] = inputTokens + outputTokens
        row["totalHeadroomAt4096"] = requestedWindow - inputTokens - outputTokens
        row["totalExceeds4096"] = inputTokens + outputTokens > requestedWindow
    } catch {
        row["status"] = "error"
        row["error"] = String(describing: error)
        row["allItemsExact"] = false
    }
    let elapsed = ContinuousClock.now - start
    row["latencyMs"] = Int(elapsed.components.seconds * 1000 + elapsed.components.attoseconds / 1_000_000_000_000_000)
    rows.append(row)
    print("\(fixture.id): status=\(row["status"]!) exact=\(row["allItemsExact"]!) ms=\(row["latencyMs"]!) tokens=\(inputTokens)/\(model.contextSize)")
}
let data = try JSONSerialization.data(withJSONObject: [
    "runAt": ISO8601DateFormatter().string(from: Date()),
    "model": "SystemLanguageModel.default (on-device macOS host)",
    "availability": String(describing: model.availability),
    "contextWindow": model.contextSize,
    "results": rows,
], options: [.prettyPrinted, .sortedKeys])
try data.write(to: outputURL)
