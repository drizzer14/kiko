import fs from 'node:fs';
import path from 'node:path';

type IconEntry = {
  appearances?: { appearance: string; value: string }[];
  filename: string;
  idiom: string;
  platform: string;
  size: string;
};

const ICON_FOLDER = path.join(
  __dirname,
  '..',
  'ios',
  'Kiko',
  'Images.xcassets',
  'AppIcon.appiconset',
);

const DARK_APPEARANCES = [{ appearance: 'luminosity', value: 'dark' }];

const readEntries = (): IconEntry[] =>
  JSON.parse(fs.readFileSync(path.join(ICON_FOLDER, 'Contents.json'), 'utf8')).images;

describe('app icon catalog', () => {
  it('lists a universal light image and a luminosity dark image, each present on disk', () => {
    const entries = readEntries();
    const light = entries.filter((entry) => entry.appearances === undefined);
    const dark = entries.filter(
      (entry) => JSON.stringify(entry.appearances) === JSON.stringify(DARK_APPEARANCES),
    );

    expect(light).toHaveLength(1);
    expect(light[0]).toMatchObject({
      filename: 'AppIcon-1024-light.png',
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    });
    expect(dark).toHaveLength(1);
    expect(dark[0].filename).toBe('AppIcon-1024.png');
    entries.forEach((entry) => {
      expect(fs.existsSync(path.join(ICON_FOLDER, entry.filename))).toBe(true);
    });
  });

  it('lists no tinted image', () => {
    const entries = readEntries();

    expect(
      entries.filter((entry) =>
        entry.appearances?.some((appearance) => appearance.value === 'tinted'),
      ),
    ).toEqual([]);
    expect(entries).toHaveLength(2);
  });
});
