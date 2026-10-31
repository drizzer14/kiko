// Semgrep fixture (POSITIVE): kiko-no-device-idiom MUST report a finding on every pinned line
// below. Never "fix" this file — see kiko-architecture's "Pane navigation".
import UIKit

func readsIdiom() -> Bool {
  // EXPECT-FINDING
  return UIDevice.current.userInterfaceIdiom == .pad
}

func readsTraitIdiom(_ traits: UITraitCollection) -> Bool {
  // EXPECT-FINDING
  return traits.userInterfaceIdiom == .pad
}
