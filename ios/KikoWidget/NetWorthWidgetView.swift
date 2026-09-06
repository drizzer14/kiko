import SwiftUI
import WidgetKit

/// The Medium-family widget view. Renders content when a snapshot decoded
/// successfully, or a placeholder ("Open Kiko") when it did not — the
/// provider already collapsed every failure mode (missing container, missing
/// file, unreadable data, malformed JSON) down to `snapshot == nil`.
///
/// The content is an exact visual copy of the home screen's net-worth card
/// (`src/screens/home/home.screen.tsx`) — a centered title, the large total,
/// and a two-column per-currency breakdown table — minus the trend chart.
struct NetWorthWidgetView: View {
    let entry: NetWorthEntry

    // The app is dark-only. These mirror the design-system theme tokens in
    // `src/design-system/theme.ts` so the widget reads as the same dark card.
    private static let textSecondary = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255)
        .opacity(0.60)
    private static let negativeRed = Color(red: 255 / 255, green: 69 / 255, blue: 58 / 255)

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                content(for: snapshot)
            } else {
                placeholder
            }
        }
        .widgetBackground()
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "wallet.pass")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text("Open Kiko")
                .font(.headline)
            Text("Track your net worth here")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func content(for snapshot: NetWorthSnapshot) -> some View {
        // Mirrors the home card: <Box gap={1}> with centered header, a display
        // total, then the breakdown a spacing(4) below. gap(1) = 4pt,
        // spacing(4) = 16pt, padding(4) = 16pt.
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Self.textSecondary)

            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))
                .foregroundStyle(snapshot.total.minorUnits < 0 ? Self.negativeRed : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            breakdownTable(snapshot.breakdown)
                .padding(.top, 16)
        }
        .frame(maxWidth: .infinity)
    }

    /// The two-column breakdown table from `CurrencyBreakdown`: a row-major
    /// fill (even indices left, odd indices right), each column flexing to
    /// equal width, each cell a currency code on the left and its formatted
    /// amount on the right. The app's home card uses a 48pt column gutter
    /// (spacing(12)) sized for a full-width phone screen; inside a ~330pt
    /// medium widget that steals width the amounts need, so the widget uses
    /// a 12pt gutter. rowGap = 4pt.
    private func breakdownTable(_ breakdown: [NetWorthSnapshot.BreakdownItem]) -> some View {
        let left = breakdown.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element)
        let right = breakdown.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element)

        return HStack(alignment: .top, spacing: 12) {
            breakdownColumn(left)
            breakdownColumn(right)
        }
    }

    private func breakdownColumn(_ items: [NetWorthSnapshot.BreakdownItem]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(items) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(Self.textSecondary)
                    Spacer()
                    Text(item.formatted)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(item.minorUnits < 0 ? Self.negativeRed : .white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private extension View {
    /// iOS 17 introduced `containerBackground(for:)` as the required way to
    /// supply a widget's background; iOS 16 widgets don't need it. Guard so
    /// the same view compiles against either deployment target. The color is
    /// the app's dark card surface (#1C1C1E) — the app is dark-only, so the
    /// widget reads as the same card in every system appearance.
    @ViewBuilder
    func widgetBackground() -> some View {
        let surface = Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) {
                surface
            }
        } else {
            self.background(surface)
        }
    }
}
