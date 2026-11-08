import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MCC_NAMES_NOTICE } from '@kiko/categories/mcc-names';

import { MCC_SOURCES } from '../scripts/mcc-names/generate-mcc-names';

type Notice = Readonly<
  Record<string, { source: string; licenseName: string; licenseText?: string }>
>;

const SOMINEMO_LICENSE_SHA256 = 'ea371db4627976fe5c82dacb744ed2deb0391e6d4a23a6aecc9ea64f4858626a';

// Joined at runtime: the notice file is the very module under test, and a literal path would
// make the suite import it statically and the feature-imports rule flag the relative leave.
const NOTICE_MODULE = join(__dirname, '..', 'src/categories/mcc-names', 'mcc-names.notice');

const sources = MCC_SOURCES as Record<string, { license: string }>;

const barrelNotice = (): Notice => MCC_NAMES_NOTICE;

const noticeModuleNotice = (): Notice =>
  (require(NOTICE_MODULE) as { MCC_NAMES_NOTICE: Notice }).MCC_NAMES_NOTICE;

const sha256Of = (text: string | undefined): string =>
  createHash('sha256')
    .update(text ?? '', 'utf8')
    .digest('hex');

describe('bundled MCC names notice', () => {
  it('ships the full license text of every MIT source', () => {
    const mitKeys = Object.keys(sources).filter((key) => sources[key].license === 'MIT');

    expect(mitKeys).toEqual(['sominemo']);

    const notice = barrelNotice();

    mitKeys.forEach((key) => {
      expect(sha256Of(notice[key]?.licenseText)).toBe(SOMINEMO_LICENSE_SHA256);
    });
  });

  it('credits every source with its repository and license name', () => {
    const notice = barrelNotice();

    expect(Object.keys(notice)).toEqual(Object.keys(sources));
    expect(notice.greggles).toEqual({
      source: 'https://github.com/greggles/mcc-codes',
      licenseName: 'The Unlicense',
    });
    expect(notice.sominemo?.source).toBe('https://github.com/Sominemo/MCC-Localize-Dataset');
    expect(notice.sominemo?.licenseName).toBe('MIT License');
  });

  it('reaches the notice from the module the rule card imports', () => {
    expect(barrelNotice()).toBe(noticeModuleNotice());
  });
});
