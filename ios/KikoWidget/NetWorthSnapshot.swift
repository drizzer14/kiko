import Foundation

/// The single shared App Group identifier for the Kiko app and the
/// KikoWidget extension. Must match the entitlement on BOTH targets and the
/// `<APP_GROUP_ID>` used by the native `WidgetBridge` module that writes the
/// snapshot file.
enum WidgetConstants {
    static let appGroupID = "group.com.dmytro.pff"
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

    /// Every user-facing string the widget renders, resolved by the APP through
    /// `i18n.t` at snapshot-build time. Deliberately not a Localizable.strings
    /// bundle: a .lproj bundle follows the DEVICE language, while Kiko's
    /// language is a persisted in-app setting, so the two would disagree.
    /// One entry per string the widget renders FROM a snapshot, no more — the
    /// no-snapshot placeholder below cannot read this, so it holds no key here.
    /// Mirrors `NetWorthSnapshot['labels']` in src/widget/net-worth-snapshot.ts.
    struct Labels: Codable {
        let title: String
    }

    let baseCurrency: String
    let total: Total
    let breakdown: [BreakdownItem]
    let trend: [TrendPoint]
    let updatedAt: Int
    // Non-optional ON PURPOSE, like every other field here: a snapshot written
    // before this shipped has no `labels` key, so it fails to decode,
    // `SnapshotLoader.load()` returns nil, and the widget shows its placeholder
    // until the app writes again (which it does on every backgrounding). That
    // self-healing miss is preferable to an optional that would let a
    // half-localized widget render indefinitely. Do not "fix" it to `Labels?`.
    let labels: Labels
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
