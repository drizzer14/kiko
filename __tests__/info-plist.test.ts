import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ios/Kiko/Info.plist', () => {
  const plist = (): string => readFileSync(join(__dirname, '../ios/Kiko/Info.plist'), 'utf8');

  it('pins the native interface style to Dark', () => {
    // The app is dark-only in JS (unistyles + the NavigationContainer theme),
    // but Alert, the datetimepicker, the keyboard, the status bar and the
    // UITabBar glass all follow the PROCESS trait collection, which tracks the
    // device unless this key pins it.
    expect(plist()).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/);
  });

  it('pins the status bar to light content', () => {
    expect(plist()).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/,
    );
  });
});
