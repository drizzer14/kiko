// Semgrep fixture (POSITIVE): every money-bearing Text here is missing
// `.privacySensitive()`, so `kiko-widget-money-view-needs-privacysensitive`
// MUST report a finding on each. Never "fix" this file.
//
// The EXPECT-FINDING comments pin the exact lines the rule has to report: the
// second view repeats the first with renamed bindings (`snap`, `row`), which is
// what proves the rule keys on the money member being read and not on the name
// of the binding it is read from. Without the pins, the rule could stop
// matching every renamed line and still look green off the first view alone.
// A currency code is not money and is deliberately left unpinned — the row it
// sits in is still caught through its amount.
import SwiftUI

struct FixtureBadWidgetView: View {
    let snapshot: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text("Net worth")
                .font(.system(size: 13))

            // EXPECT-FINDING
            Text(snapshot.total.formatted)
                .font(.system(size: 48, weight: .bold))

            ForEach(snapshot.breakdown) { item in
                HStack(spacing: 4) {
                    Text(item.currency)
                    Spacer()
                    // EXPECT-FINDING
                    Text(item.formatted)
                }
            }
        }
    }
}

struct FixtureBadRenamedWidgetView: View {
    let snap: NetWorthSnapshot

    var body: some View {
        VStack(spacing: 4) {
            // EXPECT-FINDING
            Text(snap.total.formatted)
                .font(.system(size: 48, weight: .bold))

            ForEach(snap.breakdown) { row in
                HStack(spacing: 4) {
                    Text(row.currency)
                    Spacer()
                    // EXPECT-FINDING
                    Text(row.formatted)
                }
            }
        }
    }
}
