import WidgetKit
import SwiftUI

/// One point in time for the widget's timeline. Carries the decoded snapshot
/// (or `nil` when none is available / it failed to decode) so the view layer
/// makes a single placeholder-vs-content decision.
struct NetWorthEntry: TimelineEntry {
    let date: Date
    let snapshot: NetWorthSnapshot?
}

struct NetWorthTimelineProvider: TimelineProvider {
    /// Shown in the widget gallery / while the real snapshot is loading.
    func placeholder(in context: Context) -> NetWorthEntry {
        NetWorthEntry(date: Date(), snapshot: NetWorthTimelineProvider.previewSnapshot)
    }

    /// Shown for transient system previews (e.g. widget gallery snapshot).
    func getSnapshot(in context: Context, completion: @escaping (NetWorthEntry) -> Void) {
        let snapshot = context.isPreview
            ? NetWorthTimelineProvider.previewSnapshot
            : SnapshotLoader.load()
        completion(NetWorthEntry(date: Date(), snapshot: snapshot))
    }

    /// The real timeline. The app also calls `reloadAllTimelines()` explicitly
    /// after every write, so this periodic refresh is a safety net for time
    /// passing rather than the primary update path.
    func getTimeline(in context: Context, completion: @escaping (Timeline<NetWorthEntry>) -> Void) {
        let now = Date()
        let entry = NetWorthEntry(date: now, snapshot: SnapshotLoader.load())
        let nextRefresh = Calendar.current.date(byAdding: .minute, value: 30, to: now) ?? now.addingTimeInterval(30 * 60)
        let timeline = Timeline(entries: [entry], policy: .after(nextRefresh))
        completion(timeline)
    }

    private static let previewSnapshot = NetWorthSnapshot(
        baseCurrency: "USD",
        total: .init(formatted: "$12,345.67", minorUnits: 1_234_567),
        breakdown: [
            .init(currency: "USD", minorUnits: 800_000, formatted: "$8,000.00"),
            .init(currency: "EUR", minorUnits: 434_567, formatted: "€4,345.67"),
        ],
        updatedAt: 0
    )
}

struct NetWorthWidget: Widget {
    let kind: String = "NetWorthWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NetWorthTimelineProvider()) { entry in
            NetWorthWidgetView(entry: entry)
        }
        .configurationDisplayName("Net Worth")
        .description("Your total net worth at a glance.")
        .supportedFamilies([.systemMedium])
    }
}
