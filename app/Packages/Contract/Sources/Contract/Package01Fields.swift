// Hand-written, beside the generated client: every response field package 01 reads, named once (issue #11).
// Renaming or removing one of these in contract/openapi.yaml and regenerating breaks this file, so the app build fails
// at the field instead of at run time. Add a line here when a route or a field enters the file.
public enum Package01Fields {
    public static let read: [AnyKeyPath] = [
        // POST /auth/apple
        \Operations.signInWithApple.Output.Ok.Body.jsonPayload.access_token,
        \Operations.signInWithApple.Output.Ok.Body.jsonPayload.refresh_token,
        \Operations.signInWithApple.Output.Ok.Body.jsonPayload.expires_at,
        \Operations.signInWithApple.Output.Ok.Body.jsonPayload.created,
        \Operations.signInWithApple.Output.Ok.Body.jsonPayload.me,
        // GET /home
        \Operations.getHome.Output.Ok.Body.jsonPayload.order,
        \Operations.getHome.Output.Ok.Body.jsonPayload.people,
        // GET /beliefs/{id}
        \Operations.getBelief.Output.Ok.Body.jsonPayload.belief,
        \Operations.getBelief.Output.Ok.Body.jsonPayload.receipts,
        // PATCH /beliefs/{id}
        \Operations.patchBelief.Output.Ok.Body.jsonPayload.belief,
        // GET /people
        \Operations.getPeople.Output.Ok.Body.jsonPayload.people,
        // PUT /links/{person}/share/items/{belief_id}
        \Operations.shareItem.Output.Ok.Body.jsonPayload.item,
        \Operations.shareItem.Output.Ok.Body.jsonPayload.itemPayload.belief_id,
        \Operations.shareItem.Output.Ok.Body.jsonPayload.itemPayload.shared,
        \Operations.shareItem.Output.Ok.Body.jsonPayload.itemPayload.shared_wording,
        // POST /invites/{code}/accept
        \Operations.acceptInvite.Output.Ok.Body.jsonPayload.person,
        \Operations.acceptInvite.Output.Ok.Body.jsonPayload.link_id,
        // GET /threads/{person}
        \Operations.getThread.Output.Ok.Body.jsonPayload.person,
        \Operations.getThread.Output.Ok.Body.jsonPayload.link,
        \Operations.getThread.Output.Ok.Body.jsonPayload.linkPayload.status,
        \Operations.getThread.Output.Ok.Body.jsonPayload.items,
        \Operations.getThread.Output.Ok.Body.jsonPayload.draft,
        // DELETE /drafts/{person}
        \Operations.deleteDraft.Output.Ok.Body.jsonPayload.deleted,
        // GET /people/{person}/map
        \Operations.getPersonMap.Output.Ok.Body.jsonPayload.person,
        // POST /bridge/insight
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.seq,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.state,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.spans,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.line,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.resources,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.headline,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.highlights,
        \Operations.bridgeInsight.Output.Ok.Body.jsonPayload.from_me,
        // POST /bridges
        \Operations.sendBridge.Output.Ok.Body.jsonPayload.bridge,
        // POST /bridges/{id}/open
        \Operations.openBridge.Output.Ok.Body.jsonPayload.bridge,
        \Operations.openBridge.Output.Ok.Body.jsonPayload.bridgePayload.Value2Payload.final,
        \Operations.openBridge.Output.Ok.Body.jsonPayload.opened_at,
        // PUT /devices/apns
        \Operations.registerApnsDevice.Output.Ok.Body.jsonPayload.device,
        \Operations.registerApnsDevice.Output.Ok.Body.jsonPayload.devicePayload.installation_id,
        \Operations.registerApnsDevice.Output.Ok.Body.jsonPayload.devicePayload.enabled,
        // DELETE /devices/apns/{installation_id}
        \Operations.removeApnsDevice.Output.Ok.Body.jsonPayload.removed,
        \Operations.removeApnsDevice.Output.Ok.Body.jsonPayload.installation_id,
        // GET /export
        \Operations.exportData.Output.Ok.Body.jsonPayload.exported_at,
        \Operations.exportData.Output.Ok.Body.jsonPayload.me,
        // DELETE /account
        \Operations.deleteAccount.Output.Ok.Body.jsonPayload.deleted,
        // Person
        \Components.Schemas.Person.id,
        \Components.Schemas.Person.name,
        \Components.Schemas.Person.initial,
        \Components.Schemas.Person.color,
        \Components.Schemas.Person.photo_url,
        \Components.Schemas.Person.deleted,
        \Components.Schemas.Person.tz,
        // PersonOrNull
        \Components.Schemas.PersonOrNull.id,
        \Components.Schemas.PersonOrNull.name,
        \Components.Schemas.PersonOrNull.initial,
        \Components.Schemas.PersonOrNull.color,
        \Components.Schemas.PersonOrNull.photo_url,
        \Components.Schemas.PersonOrNull.deleted,
        \Components.Schemas.PersonOrNull.tz,
        // Me
        \Components.Schemas.Me.person,
        \Components.Schemas.Me.created_at,
        // HomeRow
        \Components.Schemas.HomeRow.person,
        \Components.Schemas.HomeRow.reasons,
        \Components.Schemas.HomeRow.unread,
        \Components.Schemas.HomeRow.draft,
        \Components.Schemas.HomeRow.activity_at,
        // PeopleRow
        \Components.Schemas.PeopleRow.person,
        \Components.Schemas.PeopleRow.relationship,
        \Components.Schemas.PeopleRow.status,
        // Belief
        \Components.Schemas.Belief.belief_id,
        \Components.Schemas.Belief.statement,
        \Components.Schemas.Belief.own_wording,
        \Components.Schemas.Belief.rating,
        \Components.Schemas.Belief.status,
        // Receipt
        \Components.Schemas.Receipt.quote,
        \Components.Schemas.Receipt.said_at,
        // Draft
        \Components.Schemas.Draft.text,
        \Components.Schemas.Draft.reply_to,
        \Components.Schemas.Draft.updated_at,
        // DraftReply
        \Components.Schemas.DraftReply.draft,
        // Bridge
        \Components.Schemas.Bridge.id,
        \Components.Schemas.Bridge.from,
        \Components.Schemas.Bridge.deliver_at,
        \Components.Schemas.Bridge.opened_at,
        \Components.Schemas.Bridge.reply_to,
        \Components.Schemas.Bridge.final,
        \Components.Schemas.Bridge.sealed,
        \Components.Schemas.Bridge.ready,
        \Components.Schemas.Bridge.status,
        // ThreadItem
        \Components.Schemas.ThreadItem.kind,
        \Components.Schemas.ThreadItem.bridge,
        // Span
        \Components.Schemas.Span.start,
        \Components.Schemas.Span.end,
        \Components.Schemas.Span.kind,
        // Highlight
        \Components.Schemas.Highlight.start,
        \Components.Schemas.Highlight.end,
        \Components.Schemas.Highlight.original,
        \Components.Schemas.Highlight.suggested,
        \Components.Schemas.Highlight.why_line,
        \Components.Schemas.Highlight.friction_kind,
        // FromMe
        \Components.Schemas.FromMe.item_id,
        \Components.Schemas.FromMe.wording,
    ]
}
