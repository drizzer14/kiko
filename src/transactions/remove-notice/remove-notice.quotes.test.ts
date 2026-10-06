jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { removeHoldingsPlan: jest.fn() },
}));

import { i18n } from '@kiko/i18n/init';

import {
  type RemovePlan,
  type ExchangeRemoval,
  type RemoveHoldingsPlan,
  removeNotice,
  removeHoldingsNotice,
} from './remove-notice';

// The names the text quotes, in reading order: one entry per «…» pair.
const quotedNamesOf = (text: string | undefined): string[] =>
  Array.from((text ?? '').matchAll(/«([^«»]*)»/g), (match) => match[1] ?? '');

const openCountOf = (text: string | undefined): number => (text ?? '').split('«').length - 1;

const closeCountOf = (text: string | undefined): number => (text ?? '').split('»').length - 1;

const expectWellFormedQuotes = (text: string | undefined, pairs: number): void => {
  expect(openCountOf(text)).toBe(pairs);
  expect(closeCountOf(text)).toBe(pairs);
  expect(text).not.toContain('««');
  expect(text).not.toContain('»»');
};

const DOLLAR = 'Долар';
const CASH = 'Готівка';

// `pairs` lists the quoted names in reading order: a template that mentions its
// holding twice ("…в «X»… перевірте «X»") quotes it twice on purpose.
const singleNameKeys: {
  key: string;
  plan: RemovePlan;
  pairs: string[];
}[] = [
  {
    key: 'deposit',
    plan: { split: false, deposit: { name: DOLLAR, matched: true } },
    pairs: [DOLLAR],
  },
  {
    key: 'depositKept',
    plan: { split: false, deposit: { name: DOLLAR, matched: false } },
    pairs: [DOLLAR, DOLLAR],
  },
  {
    key: 'exchangeUnlinked',
    plan: { split: false, exchange: { kind: 'missing', name: DOLLAR } },
    pairs: [DOLLAR, DOLLAR],
  },
  {
    key: 'exchangeAlsoKept',
    plan: { split: false, exchange: { kind: 'deleted', names: [DOLLAR], keptNames: [CASH] } },
    pairs: [DOLLAR, CASH],
  },
  {
    key: 'splitExchange',
    plan: { split: true, splitExchanges: [{ kind: 'deleted', names: [DOLLAR] }] },
    pairs: [DOLLAR],
  },
  {
    key: 'splitExchangeSyncedKept',
    plan: { split: true, splitExchanges: [{ kind: 'syncedKept', names: [DOLLAR] }] },
    pairs: [DOLLAR],
  },
  {
    key: 'splitExchangeUnlinked',
    plan: { split: true, splitExchanges: [{ kind: 'missing', name: DOLLAR }] },
    pairs: [DOLLAR, DOLLAR],
  },
  {
    key: 'balanceChange',
    plan: {
      split: false,
      balanceChanges: [{ name: DOLLAR, currency: 'USD', minorUnits: -1_000 }],
    },
    pairs: [DOLLAR],
  },
];

const NOTHING_ELSE: RemoveHoldingsPlan = {
  deletedRows: { count: 0, names: [] },
  reversedContributions: [],
  keptContributions: [],
  keptSynced: [],
  unlinked: [],
  unlinkedPlain: false,
};

const listedExchanges: [string, ExchangeRemoval][] = [
  ['exchange', { kind: 'deleted', names: [DOLLAR, CASH] }],
  ['exchangeSyncedKept', { kind: 'syncedKept', names: [DOLLAR, CASH] }],
];

const holdingsParts: [string, Partial<RemoveHoldingsPlan>][] = [
  ['contributions', { reversedContributions: [DOLLAR, CASH] }],
  ['contributionsKept', { keptContributions: [DOLLAR, CASH] }],
  ['syncedKept', { keptSynced: [DOLLAR, CASH] }],
  ['unlinked', { unlinked: [DOLLAR, CASH] }],
];

const englishHoldingsParts: [string, Partial<RemoveHoldingsPlan>][] = [
  ['rows', { deletedRows: { count: 2, names: [DOLLAR, CASH] } }],
  ...holdingsParts,
];

describe('the quotes of the delete-confirm names', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  describe('a key that takes one name', () => {
    it.each(singleNameKeys)(
      '$key quotes each mention of the name once in Ukrainian',
      async ({ plan, pairs }) => {
        await i18n.changeLanguage('uk');

        const text = removeNotice(plan, i18n.t);

        expect(quotedNamesOf(text)).toEqual(pairs);
        expectWellFormedQuotes(text, pairs.length);
      },
    );

    it.each(singleNameKeys)('$key carries no Ukrainian quote in English', ({ plan }) => {
      const text = removeNotice(plan, i18n.t);

      expect(text).toContain(DOLLAR);
      expect(text).not.toContain('«');
      expect(text).not.toContain('»');
    });
  });

  describe('a key that lists names', () => {
    it.each(listedExchanges)(
      '%s quotes each name on its own, comma-joined',
      async (_key, exchange) => {
        await i18n.changeLanguage('uk');

        const text = removeNotice({ split: false, exchange }, i18n.t);

        expect(text).toContain(`«${DOLLAR}», «${CASH}»`);
        expect(quotedNamesOf(text)).toEqual([DOLLAR, CASH]);
        expectWellFormedQuotes(text, 2);
      },
    );

    it.each(listedExchanges)('%s lists the names unquoted in English', (_key, exchange) => {
      const text = removeNotice({ split: false, exchange }, i18n.t);

      expect(text).toContain(`${DOLLAR}, ${CASH}`);
      expect(text).not.toContain('«');
      expect(text).not.toContain('»');
    });
  });

  describe('the holdings delete notice', () => {
    it.each([1, 2, 5, 21])('rows with a count of %s quotes each holding once', async (count) => {
      await i18n.changeLanguage('uk');

      const text = removeHoldingsNotice(
        { ...NOTHING_ELSE, deletedRows: { count, names: [DOLLAR, CASH] } },
        i18n.t,
      );

      expect(text).toContain(`«${DOLLAR}», «${CASH}»`);
      expect(quotedNamesOf(text)).toEqual([DOLLAR, CASH]);
      expectWellFormedQuotes(text, 2);
    });

    it.each(holdingsParts)('%s quotes each holding once in Ukrainian', async (_key, part) => {
      await i18n.changeLanguage('uk');

      const text = removeHoldingsNotice({ ...NOTHING_ELSE, ...part }, i18n.t);

      expect(text).toContain(`«${DOLLAR}», «${CASH}»`);
      expect(quotedNamesOf(text)).toEqual([DOLLAR, CASH]);
      expectWellFormedQuotes(text, 2);
    });

    it.each(englishHoldingsParts)('%s lists the holdings unquoted in English', (_key, part) => {
      const text = removeHoldingsNotice({ ...NOTHING_ELSE, ...part }, i18n.t);

      expect(text).toContain(`${DOLLAR}, ${CASH}`);
      expect(text).not.toContain('«');
      expect(text).not.toContain('»');
    });
  });
});
