// Semgrep fixture (NEGATIVE): the same views, correctly redacted — the total
// carries its own `.privacySensitive()`, the breakdown row carries one for the
// whole row. `kiko-widget-money-view-needs-privacysensitive` MUST report
// nothing here. The bare "Net worth" label stays visible on purpose.
//
// The second view repeats the first with renamed bindings (`snap`, `row`): a
// redacted money view is redacted whatever its binding is called.
//
// The third view (`FixtureGoodHelperWidgetView`) is the real
// `NetWorthWidgetView` shape as of the 2026-09-07 "---" task: a private
// `moneyText(_:...)` helper takes the formatted string as a plain parameter
// and does `Text(formatted)` inside itself. The rule's pattern is
// `Text($X)` where `$X` matches `.*\.(formatted|minorUnits|total)(\.|$)` — a
// bare parameter named `formatted` does not match that regex, and the call
// site (`moneyText(snapshot.total.formatted, ...)`) is not a `Text(...)`
// call at all, so the rule legitimately produces no finding here. This does
// NOT weaken the rule: `.bad.swift`'s direct `Text(snapshot.total.formatted)`
// / `Text(item.formatted)` shapes are unchanged and still caught, and this
// view still marks the real branch `.privacySensitive()` at the point the
// money is actually read.
import SwiftUI

struct FixtureGoodWidgetView: View {
    let snapshot: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13))

            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))
                .privacySensitive()

            ForEach(snapshot.breakdown) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                    Spacer()
                    Text(item.formatted)
                }
                .privacySensitive()
            }
        }
    }
}

struct FixtureGoodRenamedWidgetView: View {
    let snap: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text(snap.total.formatted)
                .font(.system(size: 48, weight: .bold))
                .privacySensitive()

            ForEach(snap.breakdown) { row in
                HStack(spacing: 4) {
                    Text(row.currency)
                    Spacer()
                    Text(row.formatted)
                }
                .privacySensitive()
            }
        }
    }
}

struct FixtureGoodHelperWidgetView: View {
    let snapshot: NetWorthSnapshot
    @Environment(\.redactionReasons) private var redactionReasons

    var body: some View {
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13))

            moneyText(snapshot.total.formatted, isNegative: false)

            ForEach(snapshot.breakdown) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                    Spacer()
                    moneyText(item.formatted, isNegative: false)
                }
            }
        }
    }

    @ViewBuilder
    private func moneyText(_ formatted: String, isNegative: Bool) -> some View {
        if redactionReasons.contains(.privacy) {
            Text("---")
                .unredacted()
        } else {
            Text(formatted)
                .privacySensitive()
        }
    }
}
