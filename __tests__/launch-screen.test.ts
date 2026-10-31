import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const STORYBOARD = readFileSync(join(__dirname, '../ios/Kiko/LaunchScreen.storyboard'), 'utf8');

// An explicit colour matches theme.colors.background (#000000) whatever the trait resolution or
// cached snapshot.
const ROOT_VIEW_BACKGROUND = /<view key="view"[\s\S]*?<\/view>/.exec(STORYBOARD)?.[0] ?? '';

describe('ios/Kiko/LaunchScreen.storyboard', () => {
  it('paints the root view an explicit sRGB black', () => {
    expect(ROOT_VIEW_BACKGROUND).toMatch(
      /<color key="backgroundColor" red="0" green="0" blue="0" alpha="1" colorSpace="custom" customColorSpace="sRGB"\/>/,
    );
  });

  it('uses no system or white background colour anywhere', () => {
    expect(STORYBOARD).not.toContain('systemBackgroundColor');
    expect(STORYBOARD).not.toContain('whiteColor');
  });
});
