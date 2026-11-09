import { join } from 'node:path';
import { readFileSync } from 'node:fs';

describe('ios/Kiko/Info.plist', () => {
  const plist = (): string => readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

  it('has no UIUserInterfaceStyle key, so the app can follow a scheme', () => {
    // A pinned style would outrank the window override the appearance setting sets, so native
    // chrome (Alert, the date picker, the keyboard, the tab bar glass) could not turn light.
    expect(plist()).not.toContain('UIUserInterfaceStyle');
  });

  it('leaves the status bar style at Default', () => {
    expect(plist()).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDefault<\/string>/,
    );
  });
});
