import type { AppLanguage } from '@kiko/i18n/device-language';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { detectRecurringSeries, type RecurringInput } from '@kiko/recurring/detection';

import { demoText } from '../seed/demo-text';
import { buildScreenshotDataset } from '../seed/screenshot-seed';

import { buildDemoSnapshot } from './build-demo-snapshot';

const MAIN_ANCHOR = Date.UTC(2026, 10, 3, 9);
const MONTHS_OF_2027 = Array.from({ length: 12 }, (_, month) => month);
const SHIFTED_ANCHORS = MONTHS_OF_2027.flatMap((month) => [
  Date.UTC(2027, month, 1, 9),
  Date.UTC(2027, month, 28, 9),
]);

type Case = readonly [title: string, language: AppLanguage, anchor: number];

const titleOf = (language: AppLanguage, anchor: number): string =>
  `${language} ${new Date(anchor).toISOString().slice(0, 10)}`;

const PAIRS: readonly (readonly [AppLanguage, number])[] = [
  ['en', MAIN_ANCHOR],
  ['uk', MAIN_ANCHOR],
  ...SHIFTED_ANCHORS.map((anchor): readonly [AppLanguage, number] => ['en', anchor]),
];

const CASES: readonly Case[] = PAIRS.map(
  ([language, anchor]): Case => [titleOf(language, anchor), language, anchor],
);

const inputOf = (language: AppLanguage, anchor: number): RecurringInput => {
  const snapshot = buildDemoSnapshot(buildScreenshotDataset(language, anchor));

  return {
    rows: snapshot.transactions,
    holdings: snapshot.holdings,
    accounts: snapshot.accounts,
  };
};

const keyOf = (name: string): string => merchantNameOf(name).key;

const billKeysOf = (language: AppLanguage): string[] => {
  const text = demoText[language];

  return ['Netflix', text.kyivstar, text.kyivteploenergo, 'YASNO', text.kyivvodokanal].map(keyOf);
};

const shopNamesOf = (language: AppLanguage): string[] => {
  const text = demoText[language];

  return [text.groceryStore, text.discountSupermarket, 'Uklon'];
};

describe('the demo file read by the recurring charges detection', () => {
  it.each(CASES)(
    'shows exactly the five bills, monthly and not stopped: %s',
    (_title, language, anchor) => {
      const series = detectRecurringSeries(inputOf(language, anchor), anchor);

      expect(series.map((entry) => entry.merchantKey).sort()).toEqual(billKeysOf(language).sort());

      for (const entry of series) {
        expect(entry.period).toBe('monthly');
        expect(entry.isStopped).toBe(false);
      }
    },
  );

  it.each(CASES)(
    'holds the shop and taxi rows in the input and reads none of them as a series: %s',
    (_title, language, anchor) => {
      const input = inputOf(language, anchor);
      const seriesKeys = detectRecurringSeries(input, anchor).map((entry) => entry.merchantKey);

      for (const name of shopNamesOf(language)) {
        expect(input.rows.some((row) => row.description === name)).toBe(true);
        expect(seriesKeys).not.toContain(keyOf(name));
      }
    },
  );
});
