import type { AccountRow, HoldingRow, TransactionTemplateRow } from '@kiko/db';
import { EMPTY_DRAFT, type TemplateDraft } from '@kiko/transaction-templates/draft';

import {
  buildReferenceOptions,
  resolveDraftReferences,
  resolveTemplateSeed,
} from './template-references';

const holdingOf = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Wallet',
    accountId: 'a1',
    type: 'cash',
    currency: 'UAH',
    icon: null,
    color: null,
    metadata: null,
    closedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }) as HoldingRow;

const accountOf = (overrides: Partial<AccountRow> = {}): AccountRow =>
  ({ id: 'a1', name: 'Main', institution: null, ...overrides }) as AccountRow;

const draftOf = (overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...EMPTY_DRAFT,
  ...overrides,
});

const splitDraft = draftOf({
  mode: 'split',
  holdingId: 'payer',
  currency: 'UAH',
  amountMinorUnits: 10000,
  category: 'groceries',
  returns: [{ holdingId: 'change', amountMinorUnits: 500 }],
});

const exchangeInto = (destinationHoldingId: string): TemplateDraft =>
  draftOf({
    mode: 'exchange',
    holdingId: 'source',
    currency: 'UAH',
    amountMinorUnits: 10000,
    exchange: { destinationHoldingId, destinationCurrency: 'USD', valueInMinorUnits: 250 },
  });

const exchangeDraft = exchangeInto('destination');

const referencesOf = (
  draft: TemplateDraft,
  holdings: HoldingRow[],
  accounts: AccountRow[] = [accountOf()],
  categoryKeys: string[] = ['groceries'],
) =>
  resolveDraftReferences(
    draft,
    buildReferenceOptions(draft, {
      holdings,
      accountNameById: new Map(accounts.map((account) => [account.id, account.name])),
      accountOrderById: new Map(accounts.map((account, index) => [account.id, index])),
      accountById: new Map(accounts.map((account) => [account.id, account])),
      categoryKeys,
    }),
  );

describe('resolveDraftReferences', () => {
  it('keeps every reference that is still live', () => {
    expect(
      referencesOf(splitDraft, [holdingOf({ id: 'payer' }), holdingOf({ id: 'change' })]),
    ).toEqual(splitDraft);
    expect(
      referencesOf(exchangeDraft, [
        holdingOf({ id: 'source' }),
        holdingOf({ id: 'destination', currency: 'USD' }),
      ]),
    ).toEqual(exchangeDraft);
  });

  it('turns a deleted holding into null in each slot', () => {
    expect(referencesOf(splitDraft, [])).toEqual({
      ...splitDraft,
      holdingId: null,
      returns: [{ holdingId: null, amountMinorUnits: 500 }],
    });
    expect(referencesOf(exchangeDraft, [])).toEqual({
      ...exchangeDraft,
      holdingId: null,
      exchange: { ...exchangeDraft.exchange, destinationHoldingId: null },
    });
  });

  it('turns a closed holding into null in each slot', () => {
    expect(
      referencesOf(splitDraft, [
        holdingOf({ id: 'payer', closedAt: 1 }),
        holdingOf({ id: 'change', closedAt: 1 }),
      ]),
    ).toEqual({
      ...splitDraft,
      holdingId: null,
      returns: [{ holdingId: null, amountMinorUnits: 500 }],
    });
    expect(
      referencesOf(exchangeDraft, [
        holdingOf({ id: 'source', closedAt: 1 }),
        holdingOf({ id: 'destination', currency: 'USD', closedAt: 1 }),
      ]),
    ).toEqual({
      ...exchangeDraft,
      holdingId: null,
      exchange: { ...exchangeDraft.exchange, destinationHoldingId: null },
    });
  });

  it('turns a synced holding into null where the picker never offers it', () => {
    const synced = { monobankId: 'm1' };
    const accounts = [accountOf({ institution: 'monobank' })];

    expect(
      referencesOf(
        splitDraft,
        [
          holdingOf({ id: 'payer', metadata: synced }),
          holdingOf({ id: 'change', metadata: synced }),
        ],
        accounts,
      ),
    ).toEqual({
      ...splitDraft,
      holdingId: null,
      returns: [{ holdingId: null, amountMinorUnits: 500 }],
    });
  });

  it('turns a return in another currency than the payer into null', () => {
    expect(
      referencesOf(splitDraft, [
        holdingOf({ id: 'payer' }),
        holdingOf({ id: 'change', currency: 'USD' }),
      ]),
    ).toEqual({ ...splitDraft, returns: [{ holdingId: null, amountMinorUnits: 500 }] });
  });

  it('never offers the source as its own destination', () => {
    expect(referencesOf(exchangeInto('source'), [holdingOf({ id: 'source' })]).exchange).toEqual({
      destinationHoldingId: null,
      destinationCurrency: 'USD',
      valueInMinorUnits: 250,
    });
  });

  it('turns a missing category into null and matches a stored key without its case', () => {
    const holdings = [holdingOf({ id: 'payer' }), holdingOf({ id: 'change' })];

    expect(referencesOf(splitDraft, holdings, undefined, ['dining']).category).toBeNull();
    expect(referencesOf({ ...splitDraft, category: 'Groceries' }, holdings).category).toBe(
      'Groceries',
    );
  });

  it('leaves a draft with nothing referenced as it is', () => {
    expect(referencesOf(EMPTY_DRAFT, [])).toEqual(EMPTY_DRAFT);
  });

  it('keeps the payer currency from the draft when the payer is gone, so the returns still resolve', () => {
    expect(referencesOf(splitDraft, [holdingOf({ id: 'change' })])).toEqual({
      ...splitDraft,
      holdingId: null,
    });
    expect(
      referencesOf({ ...splitDraft, currency: null }, [holdingOf({ id: 'change' })]).returns,
    ).toEqual([{ holdingId: null, amountMinorUnits: 500 }]);
  });
});

describe('resolveTemplateSeed', () => {
  const source = {
    holdings: [holdingOf({ id: 'payer' })],
    accountNameById: new Map([['a1', 'Main']]),
    accountOrderById: new Map([['a1', 0]]),
    accountById: new Map([['a1', accountOf()]]),
    categoryKeys: ['groceries'],
  };
  const rowOf = (draft: unknown): TransactionTemplateRow => ({
    id: 'tpl',
    name: 'Rent',
    draft,
    createdAt: 1,
    updatedAt: 1,
  });
  const stored = draftOf({ holdingId: 'payer', category: 'gone', description: 'Rent' });
  const seedOf = (
    row: TransactionTemplateRow | undefined,
    isReady = true,
    isHydrated = false,
    carriesName = true,
  ) => resolveTemplateSeed({ row, isReady, isHydrated, carriesName, source });

  it('resolves the stored draft against the live options and carries the template name', () => {
    expect(seedOf(rowOf(stored))).toEqual({
      templateDraft: { ...stored, category: null },
      templateName: 'Rent',
    });
  });

  it('leaves the name out when the entry does not edit the template', () => {
    expect(seedOf(rowOf(stored), true, false, false)).toEqual({
      templateDraft: { ...stored, category: null },
      templateName: null,
    });
  });

  it('reads a row whose draft is not a draft as the empty draft, keeping its name', () => {
    expect(seedOf(rowOf({ version: 99 }))).toEqual({
      templateDraft: EMPTY_DRAFT,
      templateName: 'Rent',
    });
  });

  it.each([
    ['no row', undefined, true, false],
    ['the queries still loading', rowOf(stored), false, false],
    ['the form already filled', rowOf(stored), true, true],
  ] as const)('seeds nothing with %s', (_label, row, isReady, isHydrated) => {
    expect(seedOf(row, isReady, isHydrated)).toEqual({ templateDraft: null, templateName: null });
  });
});
