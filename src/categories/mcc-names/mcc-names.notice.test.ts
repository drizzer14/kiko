import { createHash } from 'node:crypto';

import { MCC_SOURCES } from '../../../scripts/mcc-names/generate-mcc-names';

import { MCC_NAMES_NOTICE } from './mcc-names.notice';

const SOMINEMO_LICENSE_SHA256 = 'ea371db4627976fe5c82dacb744ed2deb0391e6d4a23a6aecc9ea64f4858626a';

const sources = MCC_SOURCES as Record<string, { license: string }>;

const sha256Of = (text: string | undefined): string =>
  createHash('sha256')
    .update(text ?? '', 'utf8')
    .digest('hex');

describe('bundled MCC names notice', () => {
  it('ships the full license text of every MIT source', () => {
    const mitKeys = Object.keys(sources).filter(
      (key) => sources[key].license === 'MIT',
    ) as (keyof typeof MCC_NAMES_NOTICE)[];

    expect(mitKeys).toEqual(['sominemo']);

    mitKeys.forEach((key) => {
      expect(sha256Of(MCC_NAMES_NOTICE[key].licenseText)).toBe(SOMINEMO_LICENSE_SHA256);
    });
  });

  it('credits every source with its repository and license name', () => {
    expect(Object.keys(MCC_NAMES_NOTICE)).toEqual(Object.keys(sources));
    expect(MCC_NAMES_NOTICE.greggles).toEqual({
      source: 'https://github.com/greggles/mcc-codes',
      licenseName: 'The Unlicense',
    });
    expect(MCC_NAMES_NOTICE.sominemo.source).toBe(
      'https://github.com/Sominemo/MCC-Localize-Dataset',
    );
    expect(MCC_NAMES_NOTICE.sominemo.licenseName).toBe('MIT License');
  });
});
