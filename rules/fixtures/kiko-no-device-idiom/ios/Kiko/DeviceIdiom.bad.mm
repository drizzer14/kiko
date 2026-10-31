// Semgrep fixture (POSITIVE): kiko-no-device-idiom MUST report a finding on every pinned line
// below. Never "fix" this file — see kiko-architecture's "Pane navigation".
#import <UIKit/UIKit.h>

BOOL readsIdiom(void) {
  // EXPECT-FINDING
  return [UIDevice currentDevice].userInterfaceIdiom == UIUserInterfaceIdiomPad;
}

BOOL readsMacro(void) {
  // EXPECT-FINDING
  return UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPad;
}
