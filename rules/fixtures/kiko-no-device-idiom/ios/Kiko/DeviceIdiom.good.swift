// Semgrep fixture (NEGATIVE): kiko-no-device-idiom must report nothing here. A Swift layout
// decision reads the horizontal size class.
import UIKit

func isRegular(_ traits: UITraitCollection) -> Bool {
  return traits.horizontalSizeClass == .regular
}
