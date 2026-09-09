import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ios/Kiko/Info.plist', () => {
  const plist = (): string => readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

  it('pins the native interface style to Dark, so all native chrome is dark', () => {
    // The app is dark-only, so the process trait collection is pinned to Dark:
    // Alert, the datetimepicker, the keyboard, the status bar and the UITabBar
    // glass all render dark regardless of the device's OS appearance.
    expect(plist()).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/);
  });

  it('leaves the status bar style at Default', () => {
    expect(plist()).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDefault<\/string>/,
    );
  });
});
