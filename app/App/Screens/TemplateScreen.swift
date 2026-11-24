import DesignKit
import Flows
import SwiftUI

/// Template for every screen that shows server data: one `LoadState`, all four cases, no `default`.
/// Copy this shape; removing a case fails the build.
struct TemplateScreen: View {
    let state: LoadState<[String]>
    let retry: () -> Void

    var body: some View {
        ZStack {
            Palette.cream.ignoresSafeArea()
            content
                .padding(Space.m)
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            ProgressView()
                .tint(Palette.teal)
                .accessibilityIdentifier("template.loading")
        case .empty:
            Text("Nothing here yet.")
                .textStyle(.body)
                .foregroundStyle(Palette.teal)
                .accessibilityIdentifier("template.empty")
        case .failed(let failure):
            VStack(spacing: Space.s) {
                Text("This didn't load.")
                    .textStyle(.body)
                    .foregroundStyle(Palette.teal)
                if failure.canRetry {
                    Button("Try again", action: retry)
                        .textStyle(.label)
                        .tint(Palette.teal)
                        .accessibilityIdentifier("template.retry")
                }
            }
            .accessibilityIdentifier("template.failed")
        case .loaded(let items):
            List(items, id: \.self) { item in
                Text(item).textStyle(.body)
            }
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("template.list")
        }
    }
}

#Preview("Loaded") { TemplateScreen(state: .loaded(["One", "Two"]), retry: {}) }
#Preview("Failed") { TemplateScreen(state: .failed(LoadFailure(kind: .offline)), retry: {}) }
