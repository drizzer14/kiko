// Semgrep fixture (NEGATIVE): a normal, non-visibility @env build flag read
// and a normal src import must both stay clean under
// `kiko-no-hidden-feature-flag-or-demo-import`.
import { SCREENSHOT_MODE } from '@env';

import type { Money } from '../../src/currency/money';
import { formatMoney } from '../../src/currency/format';

export const isScreenshotMode = (): boolean => SCREENSHOT_MODE === 'true';

export const formatted = (money: Money): string => formatMoney(money);

/**
 * The ONE legitimate crossing from app source into `e2e/` (documented in
 * `src/migration/migrations-gate/migrations.gate.tsx` and
 * `docs/harness/documented-exceptions.md`): a gated, dead-branched dynamic
 * `require`, never a static `import`. Metro's constant-folding deletes this
 * whole block — including the `require` — before dependency collection when
 * `SCREENSHOT_MODE` is not `'true'`, so it never reaches the shipping bundle.
 */
export const seedScreenshotDataIfEnabled = async (): Promise<void> => {
  if (SCREENSHOT_MODE === 'true') {
    const { seedScreenshotData } =
      require('../../e2e/screenshot/seed/screenshot-seed') as typeof import('../../e2e/screenshot/seed/screenshot-seed');

    await seedScreenshotData();
  }
};
