import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ios/Kiko/Info.plist', () => {
  const plist = (): string => readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

  it('does NOT pin the native interface style, so native chrome follows the chosen scheme', () => {
    // The app now supports both light and dark color schemes, so the process
    // trait collection must NOT be pinned to Dark: Alert, the datetimepicker,
    // the keyboard, the status bar and the UITabBar glass follow the user's
    // chosen scheme. `UIUserInterfaceStyle` is therefore absent from the plist.
    expect(plist()).not.toMatch(/<key>UIUserInterfaceStyle<\/key>/);
  });

  it('leaves the status bar style at Default so it follows the chosen scheme', () => {
    expect(plist()).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDefault<\/string>/,
    );
  });
});
