// Semgrep fixture (NEGATIVE): kiko-no-device-idiom must report nothing here. Objective-C layout
// code reads the horizontal size class.
#import <UIKit/UIKit.h>

BOOL isRegular(UITraitCollection *traits) {
  return traits.horizontalSizeClass == UIUserInterfaceSizeClassRegular;
}
