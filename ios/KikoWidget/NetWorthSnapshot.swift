import Foundation

/// The single shared App Group identifier for the Kiko app and the
/// KikoWidget extension. Must match the entitlement on BOTH targets and the
/// `<APP_GROUP_ID>` used by the native `WidgetBridge` module that writes the
/// snapshot file.
enum WidgetConstants {
    static let appGroupID = "group.com.dmytro-vasylkivskyi.kiko"
    static let snapshotFileName = "net-worth-snapshot.json"
}

/// Mirrors `NetWorthSnapshot` in `src/widget/net-worth-snapshot.ts` EXACTLY.
/// The widget never re-derives net worth math; it only decodes and renders
/// the numbers the app already computed.
struct NetWorthSnapshot: Codable {
    struct Total: Codable {
        let formatted: String
        let minorUnits: Int
    }

    struct BreakdownItem: Codable, Identifiable {
        let currency: String
        let minorUnits: Int
        let formatted: String

        // Not part of the wire format; lets SwiftUI iterate without index math.
        var id: String { currency }
    }

    struct TrendPoint: Codable {
        let time: Int
        // `amount` on the TS side (`NetWorthPoint`) is the total in base MAJOR
        // units (a float), not minor units, so this is a Double, not an Int.
        let value: Double
    }

    let baseCurrency: String
    let total: Total
    let breakdown: [BreakdownItem]
    let trend: [TrendPoint]
    let updatedAt: Int
}

enum SnapshotLoader {
    /// Reads and decodes the snapshot the app's `WidgetBridge` wrote into the
    /// shared App Group container. Returns `nil` on ANY failure (missing
    /// container, missing file, unreadable data, malformed JSON) so callers
    /// can fall back to the placeholder — this must never throw into the
    /// timeline provider.
    static func load() -> NetWorthSnapshot? {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: WidgetConstants.appGroupID
            )
        else {
            return nil
        }

        let fileURL = containerURL.appendingPathComponent(WidgetConstants.snapshotFileName)

        guard let data = try? Data(contentsOf: fileURL) else {
            return nil
        }

        return try? JSONDecoder().decode(NetWorthSnapshot.self, from: data)
    }
}
