import Contract
import Flows
import Foundation

/// The calls the hosts make, one per contract operation, each through the generated client (`APIClient.client`) and
/// answered in the terms every flow takes: the decoded 2xx body, or a `CallFailure`. No flow logic here.
extension APIClient {
    typealias Answer<Value> = Result<Value, CallFailure>

    /// Runs one call; a thrown error (offline, timeout, an unreadable body) becomes its `CallFailure`.
    static func answer<Value>(_ call: () async throws -> Answer<Value>) async -> Answer<Value> {
        do {
            return try await call()
        } catch {
            return .failure(failure(for: error))
        }
    }

    // MARK: Me and home

    func getMe() async -> Answer<Operations.getMe.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getMe() {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func getHome() async -> Answer<Operations.getHome.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getHome() {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func getPeople() async -> Answer<Operations.getPeople.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getPeople() {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    // MARK: Talk

    func talkTurn(_ body: Operations.commTalkTurn.Input.Body.jsonPayload) async -> Answer<Operations.commTalkTurn.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.commTalkTurn(body: .json(body)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    enum Kept {
        case created(Components.Schemas.CommItemCreated)
        case notKept(Components.Schemas.CommItemNotKept)
    }

    func addCommItem(_ body: Operations.addCommItem.Input.Body.jsonPayload) async -> Answer<Kept> {
        await Self.answer {
            switch try await client.addCommItem(body: .json(body)) {
            case let .created(created): .success(.created(try created.body.json))
            case let .ok(ok): .success(.notKept(try ok.body.json))
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func markPartly(beliefId: String) async -> Answer<Void> {
        await Self.answer {
            switch try await client.patchBelief(path: .init(id: beliefId), body: .json(.init(rating: .partly))) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func share(personId: String, beliefId: String) async -> Answer<Void> {
        await Self.answer {
            switch try await client.shareItem(path: .init(person: personId, belief_id: beliefId), body: .json(.init(shared: true))) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    // MARK: You

    func getCommItems() async -> Answer<Operations.getCommItems.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getCommItems() {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func getBelief(id: String) async -> Answer<Operations.getBelief.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getBelief(path: .init(id: id)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func getVisibility(itemId: String) async -> Answer<Operations.getCommItemVisibility.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.getCommItemVisibility(path: .init(id: itemId)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    // MARK: Thread

    func getDraft(personId: String) async -> Answer<Components.Schemas.DraftReply> {
        await Self.answer {
            switch try await client.getDraft(path: .init(person: personId)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func putDraft(personId: String, text: String, replyTo: String?) async -> Answer<Void> {
        await Self.answer {
            switch try await client.putDraft(path: .init(person: personId), body: .json(.init(text: text, reply_to: replyTo))) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func deleteDraft(personId: String) async -> Answer<Void> {
        await Self.answer {
            switch try await client.deleteDraft(path: .init(person: personId)) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func getPersonMap(personId: String) async -> Answer<Void> {
        await Self.answer {
            switch try await client.getPersonMap(path: .init(person: personId)) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func insight(_ body: Operations.bridgeInsight.Input.Body.jsonPayload) async -> Answer<Operations.bridgeInsight.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.bridgeInsight(body: .json(body)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func sendBridge(_ body: Operations.sendBridge.Input.Body.jsonPayload) async -> Answer<Operations.sendBridge.Output.Ok.Body.jsonPayload> {
        await Self.answer {
            switch try await client.sendBridge(body: .json(body)) {
            case let .ok(ok): .success(try ok.body.json)
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    // MARK: Settings

    func removeDevice(installationId: String) async -> Answer<Void> {
        await Self.answer {
            switch try await client.removeApnsDevice(path: .init(installation_id: installationId)) {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    /// `GET /export`: the reply as the app saves it, re-encoded from the fields the contract names.
    func export() async -> Answer<Data> {
        await Self.answer {
            switch try await client.exportData() {
            case let .ok(ok):
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                return .success(try encoder.encode(try ok.body.json))
            case let .default(status, reply):
                return .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    func deleteAccount() async -> Answer<Void> {
        await Self.answer {
            switch try await client.deleteAccount() {
            case .ok: .success(())
            case let .default(status, reply): .failure(Self.failure(status: status, reply: reply))
            }
        }
    }

    /// A call the flow asks for whose route is not in `contract/openapi.yaml` yet (`POST`/`DELETE /consent/ai`, #8):
    /// nothing is sent, and the flow hears that it did not go through.
    static let routeNotInContract = CallFailure.http(status: 501, error: "not_implemented")
}
