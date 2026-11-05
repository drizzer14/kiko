import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import { transactions } from '@kiko/db';
import {
  type ReviewGroup,
  parseRuleMatchers,
  planReviewGroups,
  prepareRules,
  subjectOfStoredRow,
  validateRule,
  winningRule,
} from '@kiko/categories/category-rules';
import maybe, { foldMap } from 'fnts/maybe';
import { defaultDateRange } from '@kiko/dates';
import {
  SEEDED_CATEGORIES,
  LOAN_INTEREST_CATEGORY,
  TRAVEL_CATEGORY,
} from '@kiko/db/__fixtures__/seeded-categories';
import { isCrypto } from '@kiko/currency/currency';
import { buildPriceBook } from '@kiko/prices/price-book';
import { holdingValue } from '@kiko/holdings/holding-value';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { exchangeFundingMatches } from '@kiko/statistics/exchange-funding-match';
import { bankCatalog, isBankId, OTHER_BANK_ID } from '@kiko/bank-sync/bank-catalog';
import { readSeedCategoryColors } from '@kiko/db/__fixtures__/seed-category-colors';
import { parseUntrackedCounterpart } from '@kiko/transactions/untracked-counterpart';
import { draftReferences, isTemplateDraft } from '@kiko/transaction-templates/draft';

import { buildScreenshotDataset } from '../seed/screenshot-seed';

import { buildDemoSnapshot } from './build-demo-snapshot';

const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);

describe('buildDemoSnapshot', () => {
  const dataset = buildScreenshotDataset('uk', ANCHOR);
  const snapshot = buildDemoSnapshot(dataset);
  const templates = snapshot.transactionTemplates ?? [];

  it('is deterministic: two builds of the same dataset are deeply equal', () => {
    expect(buildDemoSnapshot(buildScreenshotDataset('uk', ANCHOR))).toEqual(snapshot);
  });

  it('stamps every row it creates with the dataset anchor, never a clock', () => {
    const stamps = [
      ...snapshot.accounts.map((account) => account.createdAt),
      ...snapshot.holdings.map((holding) => holding.createdAt),
      ...snapshot.transactions.map((transaction) => transaction.createdAt),
      ...snapshot.reminders.flatMap((reminder) => [
        reminder.activeSince,
        reminder.createdAt,
        reminder.updatedAt,
      ]),
      ...templates.flatMap((template) => [template.createdAt, template.updatedAt]),
    ];

    expect(stamps.length).toBeGreaterThan(0);
    expect(new Set(stamps)).toEqual(new Set([ANCHOR]));
  });

  it('holds no Cyrillic letter anywhere in the English snapshot', () => {
    const english = buildDemoSnapshot(buildScreenshotDataset('en', ANCHOR));

    expect(JSON.stringify(english)).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it('carries an empty dismissed-tips list, the unused column at its default', () => {
    expect(snapshot.settings[0].dismissedTips).toEqual([]);
  });

  it('carries every account and holding the dataset describes', () => {
    expect(snapshot.accounts).toHaveLength(dataset.accounts.length);
    expect(snapshot.holdings).toHaveLength(
      dataset.accounts.reduce((total, account) => total + account.holdings.length, 0),
    );
  });

  it('gives each account the one currency its holdings share, or the base currency', () => {
    const expected = dataset.accounts.map((account) => {
      const currencies = new Set(account.holdings.map((holding) => holding.currency));

      return currencies.size === 1 ? [...currencies][0] : dataset.baseCurrency;
    });

    expect(snapshot.accounts.map((account) => account.currency)).toEqual(expected);
    expect(new Set(expected).size).toBeGreaterThan(1);
  });

  it('carries every template the dataset describes, ided tpl-1..n in dataset order', () => {
    expect(templates.map((template) => template.id)).toEqual(
      dataset.templates.map((_template, index) => `tpl-${index + 1}`),
    );
    expect(templates.map((template) => template.name)).toEqual(
      dataset.templates.map((template) => template.name),
    );
  });

  // The seed test proves each draft passes the guard; the filter only narrows the type.
  it('gives every template a draft whose holdings and category exist in the snapshot', () => {
    const holdingIds = new Set(snapshot.holdings.map((holding) => holding.id));
    const categoryKeys = new Set(snapshot.categories.map((category) => category.key));
    const drafts = templates.map((template) => template.draft).filter(isTemplateDraft);

    expect(drafts.length).toBeGreaterThan(0);

    for (const draft of drafts) {
      const { holdingIds: referenced, categoryKey } = draftReferences(draft);

      expect(referenced.length).toBeGreaterThan(0);
      expect(referenced.every((holdingId) => holdingIds.has(holdingId))).toBe(true);
      expect(categoryKey === null || categoryKeys.has(categoryKey)).toBe(true);
    }
  });

  it('gives a template the currency of the holding it pays from and of the one an exchange lands in', () => {
    const currencyOf = new Map(snapshot.holdings.map((holding) => [holding.id, holding.currency]));
    const drafts = templates.map((template) => template.draft).filter(isTemplateDraft);

    expect(drafts.some((draft) => draft.exchange !== null)).toBe(true);

    for (const draft of drafts) {
      expect(draft.currency).toBe(currencyOf.get(draft.holdingId ?? ''));

      if (draft.exchange !== null) {
        expect(draft.exchange.destinationCurrency).toBe(
          currencyOf.get(draft.exchange.destinationHoldingId ?? ''),
        );
      }
    }
  });

  it('holds exactly BTC, USDT, UAH and EUR in the crypto account, each coin with a dated price history', () => {
    const cryptoAccount = snapshot.accounts.find((account) => account.kind === 'crypto');
    const cryptoHoldings = snapshot.holdings.filter(
      (holding) => holding.accountId === cryptoAccount?.id,
    );
    const codes = cryptoHoldings.map((holding) => holding.currency);
    const historyDaysOf = (coin: string) =>
      new Set(
        snapshot.currencyRateHistory.filter((row) => row.base === coin).map((row) => row.day),
      );

    expect(codes).toEqual(['BTC', 'USDT', 'UAH', 'EUR']);
    expect(cryptoHoldings.every((holding) => holding.type === 'crypto_asset')).toBe(true);

    for (const coin of codes.filter(isCrypto)) {
      expect(historyDaysOf(coin).size).toBeGreaterThan(1);
    }
  });

  it('prices and charts every coin it holds, so none drops out of the net worth', () => {
    const heldCoins = new Set(
      snapshot.holdings.map((holding) => holding.currency).filter(isCrypto),
    );
    const pricedBases = new Set(snapshot.currencyRates.map((rate) => rate.base));
    const chartedBases = new Set(snapshot.currencyRateHistory.map((row) => row.base));

    for (const coin of heldCoins) {
      expect(pricedBases.has(coin)).toBe(true);
      expect(chartedBases.has(coin)).toBe(true);
    }
  });

  it('gives every bank account a catalog bank id, as a post-0049 device stores it, and no other kind a bank id', () => {
    const bankIdByKind = snapshot.accounts.map((account) => [account.kind, account.bankId]);

    expect(bankIdByKind.filter(([kind]) => kind === 'bank').length).toBeGreaterThan(0);

    for (const [kind, bankId] of bankIdByKind) {
      if (kind === 'bank') {
        expect(isBankId(bankId)).toBe(true);
      } else {
        expect(bankId).toBeNull();
      }
    }
  });

  // The App Store reviewer reaches Connect only on a connectable bank's page
  // (Guideline 2.5.19), so the demo must hold one account per connectable bank.
  it('holds at least one bank account per connectable catalog bank, and one Other bank', () => {
    const demoBankIds = new Set(snapshot.accounts.map((account) => account.bankId));
    const connectableIds = bankCatalog
      .filter((entry) => entry.connectable)
      .map((entry) => entry.id);

    expect(connectableIds.length).toBeGreaterThan(0);

    for (const bankId of connectableIds) {
      expect(demoBankIds.has(bankId)).toBe(true);
    }

    expect(demoBankIds.has(OTHER_BANK_ID)).toBe(true);
  });

  // `useAutoSync` keys on `account.institution` (`src/sync/use-auto-sync/
  // use-auto-sync.ts`), so a null one means a demo bank id never starts a sync.
  it('leaves every account unconnected: institution null, so no auto-sync starts on a demo account', () => {
    expect(snapshot.accounts.every((account) => account.institution === null)).toBe(true);
  });

  it('gives every holding a balance equal to the sum of its own transactions', () => {
    for (const holding of snapshot.holdings) {
      const sum = snapshot.transactions
        .filter((transaction) => transaction.holdingId === holding.id)
        .reduce((total, transaction) => total + transaction.amountMinorUnits, 0);
      expect(holding.balanceMinorUnits).toBe(sum);
    }
  });

  it('references only real parents: every holding an account, every transaction a holding', () => {
    const accountIds = new Set(snapshot.accounts.map((account) => account.id));
    const holdingIds = new Set(snapshot.holdings.map((holding) => holding.id));
    expect(snapshot.holdings.every((holding) => accountIds.has(holding.accountId))).toBe(true);
    expect(
      snapshot.transactions.every((transaction) => holdingIds.has(transaction.holdingId)),
    ).toBe(true);
  });

  it('marks every transaction manual with no external id, so no row looks synced', () => {
    expect(snapshot.transactions.every((t) => t.source === 'manual')).toBe(true);
    expect(snapshot.transactions.every((t) => t.externalId === null)).toBe(true);
  });

  it('links every loan payment to a loan holding, manually', () => {
    const loanIds = new Set(
      snapshot.holdings.filter((holding) => holding.type === 'loan').map((holding) => holding.id),
    );
    const linked = snapshot.transactions.filter(
      (transaction) => transaction.loanHoldingId !== null,
    );

    expect(linked.length).toBeGreaterThan(0);

    for (const transaction of linked) {
      expect(loanIds.has(transaction.loanHoldingId ?? '')).toBe(true);
      expect(transaction.loanLinkSource).toBe('manual');
    }
  });

  it('prices every holding-scoped point against a real holding', () => {
    const holdingInstruments = new Set(snapshot.holdings.map((holding) => `holding:${holding.id}`));
    const holdingPoints = snapshot.pricePoints.filter((point) =>
      point.instrument.startsWith('holding:'),
    );

    expect(holdingPoints.length).toBeGreaterThan(0);
    expect(holdingPoints.every((point) => holdingInstruments.has(point.instrument))).toBe(true);
  });

  // A holding whose metadata does not parse, or whose price is missing, reads
  // as 0 on screen: the reviewer would see the type but not the feature.
  it('values every holding with no ledger of its own through the app valuation', () => {
    const book = buildPriceBook(
      snapshot.pricePoints,
      snapshot.transactions.map((transaction) => ({
        transactionId: transaction.id,
        loanHoldingId: transaction.loanHoldingId,
        time: transaction.time,
        amountMinorUnits: transaction.amountMinorUnits,
        currency: 'UAH' as const,
      })),
    );
    const ledgerless = snapshot.holdings.filter((holding) => isLedgerlessHoldingType(holding.type));

    expect(ledgerless).toHaveLength(8);

    for (const holding of ledgerless) {
      expect(holdingValue(holding, ANCHOR, book).minorUnits).not.toBe(0);
    }
  });

  it('caches the register terms of every bond added under an ISIN', () => {
    const registerIsins = new Set(snapshot.bondRegister.map((row) => row.isin));
    const bondIsins = snapshot.holdings
      .filter((holding) => holding.type === 'bond')
      .map((holding) => (holding.metadata as { isin?: string }).isin);

    expect(bondIsins.length).toBeGreaterThan(0);
    expect(bondIsins.every((isin) => isin !== undefined && registerIsins.has(isin))).toBe(true);
  });

  // A real install seeds loan_interest and travel by their own migrations; the import
  // replaces every category, so the snapshot must carry them for the linked
  // loan payment's interest and the hotel and airline codes to file under a named category.
  it('carries the 10 default categories plus loan interest and travel, and an empty syncState', () => {
    expect(snapshot.categories.map((category) => category.key)).toEqual([
      ...SEEDED_CATEGORIES.map((category) => category.key),
      LOAN_INTEREST_CATEGORY.key,
      TRAVEL_CATEGORY.key,
    ]);
    expect(snapshot.syncState).toEqual([]);
  });

  // The App Store reviewer reaches the rule editor and the rule cards only through the demo
  // file (Guideline 2.5.19), so the file must carry a rule on a name alone and one on several
  // conditions.
  describe('category rules', () => {
    const rulesOf = (demoSnapshot: typeof snapshot) =>
      demoSnapshot.categoryRules.map((rule) => ({
        rule,
        matchers: parseRuleMatchers(rule.matchers),
      }));

    it('holds a rule on a name alone and a rule on several conditions', () => {
      const matcherCounts = rulesOf(snapshot).map(({ matchers }) => matchers?.length);

      expect(matcherCounts).toEqual([1, 2]);
      expect(rulesOf(snapshot)[0].matchers).toEqual([{ type: 'nameIs', text: 'Сільпо' }]);
      expect(rulesOf(snapshot)[1].matchers).toEqual([
        { type: 'nameIs', text: 'Uklon' },
        { type: 'amount', operator: 'lt', minorUnits: 100_000, currency: 'UAH' },
      ]);
    });

    it('stores each rule as the app does: ids, a seeded category, the anchor for both stamps', () => {
      const categoryKeys = new Set(snapshot.categories.map((category) => category.key));

      expect(snapshot.categoryRules.map((rule) => rule.id)).toEqual(['rule-1', 'rule-2']);

      for (const rule of snapshot.categoryRules) {
        expect(categoryKeys.has(rule.category)).toBe(true);
        expect(rule.createdAt).toBe(ANCHOR);
        expect(rule.updatedAt).toBe(ANCHOR);
      }
    });

    it('holds only rules the rule editor would accept, none a twin of another', () => {
      const prepared = prepareRules(snapshot.categoryRules);

      expect(prepared.unreadable).toEqual([]);
      expect(prepared.ordered).toHaveLength(2);

      for (const rule of prepared.ordered) {
        expect(validateRule(rule.matchers, prepared.ordered, rule.id)).toEqual({ kind: 'valid' });
      }
    });

    it.each(['uk', 'en'] as const)(
      'agrees with the ledger in %s: every row a rule wins already holds that rule category',
      (language) => {
        const languageSnapshot = buildDemoSnapshot(buildScreenshotDataset(language, ANCHOR));
        const prepared = prepareRules(languageSnapshot.categoryRules);
        const holdingById = new Map(
          languageSnapshot.holdings.map((holding) => [holding.id, holding]),
        );
        const wins = languageSnapshot.transactions.flatMap((transaction) => {
          const rule = winningRule(
            prepared,
            subjectOfStoredRow({
              ...transaction,
              currency: holdingById.get(transaction.holdingId)?.currency ?? null,
              accountId: holdingById.get(transaction.holdingId)?.accountId ?? null,
            }),
          );

          return foldMap(maybe(rule), (won) => [{ transaction, rule: won }]) ?? [];
        });

        // Both rules win rows, so the reviewer sees each one matter in the ledger.
        expect(new Set(wins.map(({ rule }) => rule.id))).toEqual(new Set(['rule-1', 'rule-2']));

        for (const { transaction, rule } of wins) {
          expect(transaction.category).toBe(rule.category);
        }
      },
    );

    it('writes the English rules without a Cyrillic letter and the same shape', () => {
      const english = buildDemoSnapshot(buildScreenshotDataset('en', ANCHOR));

      expect(rulesOf(english).map(({ matchers }) => matchers?.length)).toEqual([1, 2]);
      expect(rulesOf(english)[0].matchers).toEqual([{ type: 'nameIs', text: 'Silpo' }]);
    });
  });

  it('seeds every category color from the branded-colors migration, matching a real fresh install', () => {
    const seedColors = new Map(readSeedCategoryColors().map((seed) => [seed.key, seed.color]));

    // Mirrors 0017's own comment: `utilities` and `entertainment` are
    // intentionally left uncolored on a real fresh install too, so they fall
    // back to the same hashed `categoryColor` both here and in production.
    expect(seedColors.size).toBe(8);

    for (const category of snapshot.categories.slice(0, SEEDED_CATEGORIES.length)) {
      expect(category.color).toBe(seedColors.get(category.key) ?? null);
    }
  });

  // The color `0039_seed_loan_interest_category.sql` seeds on a fresh install.
  it('colors loan interest the way its own migration does', () => {
    const loanInterest = snapshot.categories.find(
      (category) => category.key === LOAN_INTEREST_CATEGORY.key,
    );

    expect(loanInterest?.color).toBe('#5E5CE6');
    expect(loanInterest?.sortOrder).toBe(SEEDED_CATEGORIES.length);
  });

  it('colors Travel the way its own migration does', () => {
    const travel = snapshot.categories.find((category) => category.key === TRAVEL_CATEGORY.key);

    expect(travel?.color).toBe('#40C8E0');
    expect(travel?.sortOrder).toBe(SEEDED_CATEGORIES.length + 1);
  });

  it.each(['en', 'uk'] as const)(
    'holds a store-number name for the Apply prefix offer in the %s file',
    (language) => {
      const { transactions: rows } = buildDemoSnapshot(buildScreenshotDataset(language, ANCHOR));
      const distinctNames = [...new Set(rows.map((row) => row.description))];
      const prefixes = distinctNames.flatMap((name) => merchantNameOf(name).prefix ?? []);

      expect([...new Set(prefixes)]).toEqual(['Varus']);
    },
  );

  it('marks the file as one this build wrote', () => {
    expect(snapshot.settings[0].mccCategoriesBackfilled).toBe(true);
  });

  it('carries one settings row with the dataset language, UAH, and the lock OFF', () => {
    expect(snapshot.settings).toHaveLength(1);
    expect(snapshot.settings[0].language).toBe('uk');
    expect(snapshot.settings[0].baseCurrency).toBe('UAH');
    // Never true: importing a locked snapshot would put a reviewer behind a
    // Face ID / passcode gate on a device that may have no biometric enrolled.
    expect(snapshot.settings[0].lockEnabled).toBe(false);
  });

  it('carries the dataset rates and history verbatim', () => {
    expect(snapshot.currencyRates).toHaveLength(dataset.rates.length);
    expect(snapshot.currencyRateHistory).toHaveLength(dataset.history.length);
  });

  it('applies the requested language to the settings row', () => {
    expect(buildDemoSnapshot(buildScreenshotDataset('en', ANCHOR)).settings[0].language).toBe('en');
  });

  // The reviewer reaches every operation label only through this file (Guideline 2.5.19).
  describe('exchange operations on the crypto account', () => {
    const cryptoRowsOf = (demoSnapshot: typeof snapshot) => {
      const accountId = demoSnapshot.accounts.find((account) => account.kind === 'crypto')?.id;
      const accountHoldings = demoSnapshot.holdings.filter(
        (holding) => holding.accountId === accountId,
      );
      const holdingIds = new Set(accountHoldings.map((holding) => holding.id));

      return {
        holdings: accountHoldings,
        rows: demoSnapshot.transactions.filter((transaction) =>
          holdingIds.has(transaction.holdingId),
        ),
      };
    };
    const { holdings: cryptoHoldings, rows } = cryptoRowsOf(snapshot);
    const operationRows = rows.filter((row) => row.operation !== null);
    const pairIds = new Set(
      rows.map((row) => row.exchangePairId).filter((pairId) => pairId !== null),
    );
    const tradeLegs = (pairId: string) =>
      rows.filter((row) => row.exchangePairId === pairId && row.operation !== 'trade-fee');

    it('carries one row of every operation code on the crypto account', () => {
      const codes = operationRows.map((row) => row.operation);

      expect(new Set(codes)).toEqual(new Set(transactions.operation.enumValues));
      expect(codes.filter((code) => code === 'trade-fee')).toHaveLength(1);
      expect(codes.filter((code) => code === 'p2p')).toHaveLength(1);
      expect(codes.filter((code) => code === 'card')).toHaveLength(2);
    });

    it('holds a card sale and a trade whose other side is a coin the demo does not hold', () => {
      const sale = rows.find((row) => row.operation === 'card' && row.amountMinorUnits < 0);
      const untracked = rows.find((row) => row.untrackedCounterpart?.startsWith('asset:'));
      const heldCodes = new Set<string>(cryptoHoldings.map((holding) => holding.currency));

      expect(parseUntrackedCounterpart(sale?.untrackedCounterpart ?? null)).toMatchObject({
        kind: 'card',
        fiat: 'UAH',
      });
      expect(untracked?.operation).toBe('trade');
      expect(untracked?.exchangeCounterpartHoldingId).toBeNull();
      expect(untracked?.exchangePairId).toBeNull();

      const counterpart = parseUntrackedCounterpart(untracked?.untrackedCounterpart ?? null);

      expect(counterpart).toEqual({ kind: 'asset', code: 'PEPE' });
      expect(heldCodes.has('PEPE')).toBe(false);
    });

    it("gives the legs of each pair one pair id and points each leg at the other's holding", () => {
      expect(pairIds).toEqual(new Set(['pair-1', 'pair-2', 'pair-3']));

      const legOperations = [...pairIds].map((pairId) => {
        const [first, second, ...rest] = tradeLegs(pairId);

        expect(rest).toEqual([]);
        expect(first.holdingId).not.toBe(second.holdingId);
        expect(first.exchangeCounterpartHoldingId).toBe(second.holdingId);
        expect(second.exchangeCounterpartHoldingId).toBe(first.holdingId);
        expect(first.time).toBe(second.time);
        expect(first.operation).toBe(second.operation);

        return first.operation;
      });

      expect(new Set(legOperations)).toEqual(new Set(['convert', 'trade', 'dust']));
    });

    it("points the fee row at the received leg's holding under the trade's pair id", () => {
      const fee = rows.find((row) => row.operation === 'trade-fee');
      const received = rows.find((row) => row.operation === 'trade' && row.amountMinorUnits > 0);

      expect(fee?.exchangePairId).not.toBeNull();
      expect(fee?.exchangePairId).toBe(received?.exchangePairId);
      expect(fee?.exchangeCounterpartHoldingId).toBe(received?.holdingId);
      expect(fee?.amountMinorUnits).toBeLessThan(0);
    });

    describe.each([
      [
        'en',
        {
          fee: 'Trading fee',
          p2p: 'P2P purchase (UAH)',
          card: ['Card purchase (UAH)', 'Sale to card (UAH)'],
          asset: 'Exchange to PEPE',
          fiat: ['Bank deposit (EUR)', 'Bank withdrawal (EUR)'],
        },
      ],
      [
        'uk',
        {
          fee: 'Торгова комісія',
          p2p: 'Купівля через P2P (UAH)',
          card: ['Купівля карткою (UAH)', 'Продаж на картку (UAH)'],
          asset: 'Обмін на PEPE',
          fiat: ['Поповнення з банку (EUR)', 'Виведення в банк (EUR)'],
        },
      ],
    ] as const)('under the %s language', (language, expected) => {
      const languageSnapshot = buildDemoSnapshot(buildScreenshotDataset(language, ANCHOR));
      const languageRows = cryptoRowsOf(languageSnapshot).rows;
      const holdingNameById = new Map(
        languageSnapshot.holdings.map((holding) => [holding.id, holding.name]),
      );
      const holdingCurrencyById = new Map(
        languageSnapshot.holdings.map((holding) => [holding.id, holding.currency]),
      );
      const labelOf = (row: (typeof languageRows)[number]) =>
        transactionRowDescription({
          transaction: row,
          holdingName: holdingNameById.get(row.holdingId) ?? '',
          holdingNameById,
          holdingCurrencyById,
          t: i18n.t,
        });
      const labelsOf = (operation: string) =>
        languageRows.filter((row) => row.operation === operation).map(labelOf);

      beforeEach(async () => {
        await i18n.changeLanguage(language);
      });

      afterEach(async () => {
        await i18n.changeLanguage('en');
      });

      it('labels the fee row Trading fee and the coded rows by their code', () => {
        expect(labelsOf('trade-fee')).toEqual([expected.fee]);
        expect(labelsOf('p2p')).toEqual([expected.p2p]);
        expect(labelsOf('card')).toEqual(expected.card);
        expect(labelsOf('fiat')).toEqual(expected.fiat);
        expect(
          languageRows.filter((row) => row.untrackedCounterpart?.startsWith('asset:')).map(labelOf),
        ).toEqual([expected.asset]);
      });

      it('names the other leg in the label of each pair leg', () => {
        const legs = languageRows.filter(
          (row) =>
            ['trade', 'convert', 'dust'].includes(row.operation ?? '') &&
            row.exchangeCounterpartHoldingId !== null,
        );

        expect(legs).toHaveLength(6);

        for (const leg of legs) {
          expect(labelOf(leg)).toContain(
            holdingNameById.get(leg.exchangeCounterpartHoldingId ?? '') ?? 'no counterpart name',
          );
        }
      });
    });

    it("writes each coded row's total in its comment, as the code reads it", () => {
      const coded = rows.filter((row) => /^(p2p|card|bank):/.test(row.untrackedCounterpart ?? ''));

      const totals = coded.map((row) => {
        const counterpart = parseUntrackedCounterpart(row.untrackedCounterpart);

        return match(counterpart)
          .with(
            { kind: P.union('p2p', 'card', 'bank') },
            ({ fiat, totalMinorUnits }) => `${(totalMinorUnits ?? 0) / 100} ${fiat}`,
          )
          .otherwise(() => undefined);
      });

      expect(totals).toEqual(['2600 UAH', '1300 UAH', '4150 UAH', '100 EUR', '50 EUR']);
      expect(coded.map((row) => row.comment)).toEqual(totals);
    });

    it('dates every exchange operation row outside the default 30-day window', () => {
      const { from } = defaultDateRange(ANCHOR);

      expect(operationRows.length).toBeGreaterThan(0);

      for (const row of operationRows) {
        expect(row.time).toBeLessThan(from.getTime());
      }
    });

    it("keeps each Binance holding's end balance", () => {
      const balanceByCurrency = Object.fromEntries(
        cryptoHoldings.map((holding) => [holding.currency, holding.balanceMinorUnits]),
      );

      expect(cryptoHoldings.length).toBeGreaterThan(0);
      expect(new Set(cryptoHoldings.map((holding) => holding.currency)).size).toBe(
        cryptoHoldings.length,
      );
      expect(balanceByCurrency).toEqual({
        BTC: 1_200_000,
        USDT: 5_000_000_000,
        UAH: 100_000,
        EUR: 5_000,
      });
    });

    it('sweeps USDT dust into BTC on the two holdings', () => {
      const dustRows = rows.filter((row) => row.operation === 'dust');
      const currencyOf = (holdingId: string) =>
        cryptoHoldings.find((holding) => holding.id === holdingId)?.currency;
      const swept = dustRows.find((row) => row.amountMinorUnits < 0);
      const received = dustRows.find((row) => row.amountMinorUnits > 0);

      expect(dustRows).toHaveLength(2);
      expect(currencyOf(swept?.holdingId ?? '')).toBe('USDT');
      expect(currencyOf(received?.holdingId ?? '')).toBe('BTC');
      expect(received?.amountMinorUnits).toBe(1_000);
      expect(swept?.exchangeCounterpartHoldingId).toBe(received?.holdingId);
      expect(received?.exchangeCounterpartHoldingId).toBe(swept?.holdingId);
    });
  });

  // The matched-funding caption is reachable by the reviewer only through these debits (Guideline
  // 2.5.19).
  describe('bank debits that fund the exchange rows', () => {
    const holdingById = new Map(snapshot.holdings.map((holding) => [holding.id, holding]));
    const accountKindById = new Map(snapshot.accounts.map((account) => [account.id, account.kind]));
    const accountKindByHoldingId = new Map(
      snapshot.holdings.flatMap(
        (holding) =>
          foldMap(maybe(accountKindById.get(holding.accountId)), (kind) => [
            [holding.id, kind] as const,
          ]) ?? [],
      ),
    );
    const ledger = snapshot.transactions.flatMap(
      (transaction) =>
        foldMap(maybe(holdingById.get(transaction.holdingId)), (holding) => [
          { ...transaction, currency: holding.currency },
        ]) ?? [],
    );
    const { matches, excludedIds } = exchangeFundingMatches(ledger, accountKindByHoldingId);

    it('shows a matched bank debit for each funding kind', () => {
      expect([...matches.values()].map(({ kind }) => kind).sort()).toEqual(['bank', 'card', 'p2p']);

      for (const bankId of matches.keys()) {
        expect(excludedIds.has(bankId)).toBe(true);
      }
    });

    it('matches debits on bank holdings, never on the crypto account', () => {
      expect(matches.size).toBe(3);

      for (const bankId of matches.keys()) {
        const holdingId = snapshot.transactions.find(({ id }) => id === bankId)?.holdingId ?? '';

        expect(accountKindByHoldingId.get(holdingId)).toBe('bank');
      }
    });

    it('dates every funding debit outside the default 30-day window', () => {
      const { from } = defaultDateRange(ANCHOR);

      expect(matches.size).toBe(3);

      for (const bankId of matches.keys()) {
        const debit = snapshot.transactions.find(({ id }) => id === bankId);

        expect(debit?.time).toBeLessThan(from.getTime());
      }
    });

    it("keeps each funded bank holding's end balance", () => {
      const balanceByName = new Map(
        snapshot.holdings
          .filter((holding) => holding.type === 'card')
          .map((holding) => [`${holding.name}:${holding.currency}`, holding.balanceMinorUnits]),
      );

      expect(balanceByName.get('Монобанк:UAH')).toBe(1_333_500);
      expect(balanceByName.get('Wise:EUR')).toBe(60_000);
    });
  });
});

describe.each(['en', 'uk'] as const)('the review list of the %s demo file', (language) => {
  const demo = buildDemoSnapshot(buildScreenshotDataset(language, ANCHOR));
  const holdingById = new Map(demo.holdings.map((holding) => [holding.id, holding]));
  const candidates = demo.transactions.map((transaction) => ({
    ...transaction,
    currency: holdingById.get(transaction.holdingId)?.currency ?? null,
    accountId: holdingById.get(transaction.holdingId)?.accountId ?? null,
  }));
  const groupOf = (key: string): ReviewGroup | undefined =>
    planReviewGroups(
      prepareRules(demo.categoryRules),
      candidates,
      new Set(demo.categories.map((category) => category.key.toLowerCase())),
      [],
    ).find((group) => group.key === key);

  it('the review list offers a starts-with line on the store-number rows', () => {
    expect(groupOf('varus')?.names).toEqual(['Varus 0212', 'Varus 0340']);
    expect(groupOf('varus')?.rule).toEqual({ kind: 'nameStartsWith', text: 'Varus' });
    expect(groupOf('varus')?.rowCount).toBe(3);
  });

  it("leaves the rule demo's merchants in their own lines", () => {
    expect(groupOf('kfc')?.names).toEqual(['KFC']);
    expect(groupOf('kfc')?.rule).toEqual({ kind: 'nameIs', text: 'KFC' });
    expect(groupOf('kfc')?.rowCount).toBe(4);
    expect(groupOf('sushi master')?.names).toEqual(['Sushi Master']);
    expect(groupOf('sushi master')?.rule).toEqual({ kind: 'nameIs', text: 'Sushi Master' });
    expect(groupOf('sushi master')?.rowCount).toBe(1);
  });
});
