import { i18n } from '@kiko/i18n/init';
import type { ComponentProps } from 'react';
import {
  BANK,
  CARD,
  DOLLAR_CARD,
  chargeRowOf,
  createMarkLiveQueries,
  markOf,
  markWrites as mockWrites,
  netflixSettingsOf,
  settingsModuleWith as mockSettingsModuleWith,
  taggedQuery as mockTaggedQuery,
} from '@kiko/test-support/recurring-mark-live-queries';
import { EMPTY_DRAFT } from '@kiko/transaction-templates/draft';
import { saveItem } from '@kiko/test-support/form-header-items';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { act, fireEvent, render } from '@testing-library/react-native';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';
import '@kiko/design-system/unistyles';

import TransactionFormScreen from './transaction-form.screen';

// The mark field on the real transaction form, with the data layer a navigator test uses and the
// settings reads and writes of the field. The settings parser is the repository's own.

const mockLive = createMarkLiveQueries();
const mockTransactionWrite = jest.fn();
const mockWorld: { rows: object[]; fundingLedger: object[] } = { rows: [], fundingLedger: [] };

type Read = (query: { transactionId?: string }, enabled: boolean) => object;

const READS: Record<string, Read> = {
  byId: ({ transactionId }) => ({
    data: mockWorld.rows.filter((row) => (row as { id: string }).id === transactionId),
  }),
  ledger: (_query, enabled) => ({ data: enabled ? mockWorld.fundingLedger : [], isLoading: false }),
  distinctDescriptions: () => ({ data: [] }),
  latestManualHolding: () => ({ data: [], isLoading: false }),
};

const mockAnswer = (
  query: { __kind?: string; transactionId?: string },
  tables: string[],
  enabled = true,
) => {
  const marked = mockLive.answer(query, tables, enabled);

  if (marked !== undefined) {
    return marked;
  }

  return (
    READS[query?.__kind ?? '']?.(query, enabled) ?? {
      data: (FORM_DATA[tables[0]] ?? []) as unknown[],
      isLoading: false,
    }
  );
};

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: object, tables: string[], enabled?: boolean) =>
    mockAnswer(query, tables, enabled),
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    ...mockDataLayer.transactionsRepo.transactionsRepo,
    getByIdQuery: (transactionId: string) => mockTaggedQuery('byId', { transactionId }),
    listAllQuery: () => mockTaggedQuery('ledger'),
    distinctDescriptionsQuery: () => mockTaggedQuery('distinctDescriptions'),
    latestManualHoldingQuery: () => mockTaggedQuery('latestManualHolding'),
    recurringLedgerQuery: () => mockTaggedQuery('recurringLedger'),
    ...Object.fromEntries(
      [
        'recordExchange',
        'recordExchangeCounterpart',
        'recordManual',
        'recordManualWithReturns',
        'setCategory',
        'setLoanPayment',
        'undoAutoLoanLink',
        'update',
      ].map((name) => [name, (...args: unknown[]) => mockTransactionWrite(name, ...args)]),
    ),
  },
}));
jest.mock('@kiko/holdings/repo', () => mockDataLayer.holdingsRepo);
jest.mock('@kiko/accounts/accounts.repo', () => mockDataLayer.accountsRepo);
jest.mock('@kiko/categories/repo', () => mockDataLayer.categoriesRepo);
jest.mock('@kiko/categories/category-rules-repo', () => mockDataLayer.categoryRulesRepo);
jest.mock('@kiko/settings', () => mockSettingsModuleWith(mockWrites.repo));

type FormProps = ComponentProps<typeof TransactionFormScreen>;
type Row = ReturnType<typeof storedRowOf>;
type Change = {
  row?: Partial<Row>;
  fundingLedger?: object[];
};

const ROW_ID = 'row';
const FIELD_LABEL = i18n.t('forms.transaction.markRecurring');
const CAPTION = 'Matched to P2P purchase.';
const MINUTE = 60_000;
const PURCHASE_TIME = 1_700_000_000_000;
const OWN_IBAN = 'UA213223130000026007233566001';
const OTHER_IBAN = 'UA903052992990004149123456789';
const CASH_OUT_MCC = 6011;
const OWN_TRANSFER_MCC = 4829;
const GROCERY_MCC = 5411;
const LATER_DAY = new Date(2100, 0, 1, 10, 30).getTime();
// Every read of a `['transactions']` table the form made before the mark field.
const READS_BEFORE_THE_FIELD = ['byId', 'ledger', 'distinctDescriptions', 'latestManualHolding'];

const formHolding = (holding: typeof CARD, type = 'card') => ({
  ...holding,
  type,
  balanceMinorUnits: 0,
});
const FORM_DATA: Record<string, unknown[]> = {
  holdings: [
    formHolding(CARD),
    formHolding(DOLLAR_CARD),
    formHolding({ ...CARD, id: 'second-card', name: 'Second card', metadata: { iban: OWN_IBAN } }),
    formHolding({ ...CARD, id: 'archived-card', accountId: 'old-bank', name: 'Archived card' }),
    formHolding({ ...CARD, id: 'cash-wallet', accountId: 'cash', name: 'Wallet' }, 'cash'),
    formHolding({ ...CARD, id: 'crypto-wallet', accountId: 'binance', name: 'Exchange' }, 'cash'),
    formHolding({ ...CARD, id: 'usdt', accountId: 'binance', currency: 'USDT' }, 'crypto'),
  ],
  accounts: [
    { ...BANK, name: 'Bank' },
    { ...BANK, id: 'old-bank', name: 'Old bank', archivedAt: PURCHASE_TIME },
    { ...BANK, id: 'cash', name: 'Cash', kind: 'cash' },
    { ...BANK, id: 'binance', name: 'Binance', kind: 'crypto' },
  ],
  categories: [{ key: 'groceries', title: 'Groceries', icon: 'cart' }],
  transaction_templates: [
    {
      id: 'template-1',
      name: 'Netflix',
      createdAt: PURCHASE_TIME,
      updatedAt: PURCHASE_TIME,
      draft: { ...EMPTY_DRAFT, holdingId: 'card', description: 'Netflix' },
    },
  ],
};

const storedRowOf = (overrides: Partial<ReturnType<typeof chargeRowOf>> = {}) => ({
  ...chargeRowOf(ROW_ID, 0, -14_400, { description: 'Netflix 4412', source: 'manual' }),
  category: 'groceries',
  comment: null,
  loanLinkSource: null,
  ...overrides,
});

const SYNCED: Change = { row: { source: 'monobank' } };
const P2P_PURCHASE = chargeRowOf('buy', 0, 9_990_000_000, {
  holdingId: 'usdt',
  time: PURCHASE_TIME,
  description: 'USDT',
  untrackedCounterpart: 'p2p:UAH:4150.00',
});
const FUNDED_DEBIT: Change = {
  row: { amountMinorUnits: -415_000, time: PURCHASE_TIME - 20 * MINUTE },
  fundingLedger: [
    P2P_PURCHASE,
    chargeRowOf(ROW_ID, 0, -415_000, { time: PURCHASE_TIME - 20 * MINUTE }),
  ],
};
const UNFUNDED_DEBIT: Change = {
  row: { amountMinorUnits: -415_000, time: PURCHASE_TIME - 300 * MINUTE },
  fundingLedger: [
    P2P_PURCHASE,
    chargeRowOf(ROW_ID, 0, -415_000, { time: PURCHASE_TIME - 300 * MINUTE }),
  ],
};

const navigation = navigationSpy();

// Home, Holding Detail and a series link each open the form with this one param, so a pin on it
// holds for every path; the real navigators in `recurring-series.marks.navigator.test.tsx` hold
// the paths.
const routeOf = (): TransactionFormParams => ({ transactionId: ROW_ID });

const formElement = (params: TransactionFormParams) => (
  <TransactionFormScreen
    route={asRouteProp<FormProps['route']>('TransactionForm', params)}
    navigation={asNavigationProp<FormProps['navigation']>(navigation)}
  />
);

const open = async (params: TransactionFormParams, change: Change = {}) => {
  mockWorld.rows = [storedRowOf(change.row)];
  mockWorld.fundingLedger = change.fundingLedger ?? [];

  return render(formElement(params));
};

type Rendered = Awaited<ReturnType<typeof open>>;

const isDisabled = (rendered: Rendered): boolean =>
  rendered.getByLabelText(FIELD_LABEL).props.accessibilityState.disabled;

const pick = async (rendered: Rendered, label: string): Promise<void> => {
  await fireEvent.press(rendered.getByLabelText(FIELD_LABEL));
  await fireEvent.press(rendered.getByLabelText(label));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLive.reset();
  mockWorld.rows = [];
  mockWorld.fundingLedger = [];
  mockWrites.reset();
});

describe('the mark field on a stored debit', () => {
  it('shows on a manual debit, enabled, beside a Save', async () => {
    const rendered = await open(routeOf());

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(isDisabled(rendered)).toBe(false);
    expect(saveItem(navigation.setOptions)).toBeDefined();
  });

  it('shows and enables on a synced debit whose amount stays locked and whose header has no Save', async () => {
    const rendered = await open(routeOf(), SYNCED);

    expect(rendered.getByLabelText('Amount').props.editable).toBe(false);
    expect(saveItem(navigation.setOptions)).toBeUndefined();
    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(isDisabled(rendered)).toBe(false);
  });

  it('writes settings and no transactions row for a pick on a synced debit, and leaves Save and the draft', async () => {
    const rendered = await open(routeOf(), SYNCED);
    const amountBefore = rendered.getByLabelText('Amount').props.value;

    await pick(rendered, 'Monthly');

    expect(mockWrites.markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
      currency: 'UAH',
      amountMinorUnits: 14_400,
      period: 'monthly',
    });
    expect(mockTransactionWrite).not.toHaveBeenCalled();
    expect(saveItem(navigation.setOptions)).toBeUndefined();
    expect(rendered.getByLabelText('Amount').props.value).toBe(amountBefore);
  });

  it('takes the key and the amount of the mark from the stored row, not the unsaved draft', async () => {
    const rendered = await open(routeOf());

    await fireEvent.changeText(rendered.getByLabelText('Description'), 'Spotify');
    await fireEvent.changeText(rendered.getByLabelText('Amount'), '999');
    await pick(rendered, 'Monthly');

    expect(mockWrites.markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
      currency: 'UAH',
      amountMinorUnits: 14_400,
      period: 'monthly',
    });
    expect(mockTransactionWrite).not.toHaveBeenCalled();
    expect(rendered.getByLabelText('Description').props.value).toBe('Spotify');
    expect(rendered.getByLabelText('Amount').props.value).toBe('999');
    expect(saveItem(navigation.setOptions)).toBeDefined();
  });

  it('stores the currency of the row holding', async () => {
    const rendered = await open(routeOf(), { row: { holdingId: 'dollar-card' } });

    await pick(rendered, 'Yearly');

    expect(mockWrites.markRecurringCharge).toHaveBeenCalledWith('netflix', 'Netflix', {
      currency: 'USD',
      amountMinorUnits: 14_400,
      period: 'yearly',
    });
  });

  it('reads the chain the stored row sits in', async () => {
    mockLive.reads.settings = {
      rows: netflixSettingsOf({ marks: [markOf('yearly', 14_400)] }),
      isLoading: false,
      error: undefined,
    };
    mockLive.reads.recurringLedger = { rows: [storedRowOf()], isLoading: false, error: undefined };

    const rendered = await open(routeOf());

    expect(rendered.getByText('Yearly')).toBeTruthy();
  });
});

describe('the entries that offer no field', () => {
  const ENTRIES: [string, TransactionFormParams][] = [
    ['a holding add', { holdingId: 'card' }],
    ['a duplicate', { duplicateOfTransactionId: ROW_ID }],
    ['a template', { templateId: 'template-1' }],
    ['a template edit', { editTemplateId: 'template-1' }],
    ['a new template', { newTemplate: true }],
    ['the global add', {}],
  ];

  it.each(ENTRIES)('shows none for %s, and reads no mark', async (_title, params) => {
    const rendered = await open(params);

    expect(rendered.getByLabelText('Description')).toBeTruthy();
    expect(rendered.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(mockLive.enabledReadsOf('settings')).toBe(0);
    expect(mockLive.enabledReadsOf('recurringLedger')).toBe(0);
  });

  it('shows it for the stored row the entries above name, which is the twin', async () => {
    const rendered = await open(routeOf());

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(mockLive.enabledReadsOf('settings')).toBeGreaterThan(0);
  });
});

describe('the rows that offer no field', () => {
  // Each row: a change that takes the field away, and the change that gives it back.
  const CASES: [string, Change, Change][] = [
    ['a credit', { row: { amountMinorUnits: 14_400 } }, {}],
    ['a blank name', { row: { description: '' } }, {}],
    ['a name of spaces', { row: { description: '   ' } }, {}],
    ['a balance set', { row: { setsBalance: true } }, {}],
    ['a change group', { row: { changeGroupId: 'change-1' } }, {}],
    ['an exchange pair', { row: { exchangePairId: 'pair-1' } }, {}],
    ['an exchange counterpart holding', { row: { exchangeCounterpartHoldingId: 'usdt' } }, {}],
    ['an untracked counterpart', { row: { untrackedCounterpart: 'wallet:abc' } }, {}],
    ['a linked loan', { row: { loanHoldingId: 'loan-1' } }, {}],
    ['a cash-out MCC', { row: { mcc: CASH_OUT_MCC } }, { row: { mcc: GROCERY_MCC } }],
    [
      'a transfer to an own IBAN',
      { row: { mcc: OWN_TRANSFER_MCC, counterIban: OWN_IBAN } },
      { row: { mcc: OWN_TRANSFER_MCC, counterIban: OTHER_IBAN } },
    ],
    [
      'the deposit wording',
      { row: { description: 'Поповнення депозиту' } },
      { row: { description: 'Netflix 4412' } },
    ],
    ['a later local day', { row: { time: LATER_DAY } }, {}],
    [
      'an archived account',
      { row: { holdingId: 'archived-card' } },
      { row: { holdingId: 'card' } },
    ],
    [
      'a crypto account',
      { row: { holdingId: 'crypto-wallet' } },
      { row: { holdingId: 'cash-wallet' } },
    ],
    ['a funding caption', FUNDED_DEBIT, UNFUNDED_DEBIT],
  ];

  it.each(CASES)('shows none for %s', async (_title, away) => {
    const rendered = await open(routeOf(), away);

    expect(rendered.queryByLabelText(FIELD_LABEL)).toBeNull();
    expect(mockLive.enabledReadsOf('recurringLedger')).toBe(0);
  });

  it.each(CASES)('shows it once the rule no longer applies: %s', async (_title, _away, back) => {
    const rendered = await open(routeOf(), back);

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
  });

  it('shows none while converting, and the field is there before', async () => {
    const rendered = await open(routeOf());

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();

    await fireEvent.press(rendered.getByText('Exchange'));

    expect(rendered.queryByLabelText(FIELD_LABEL)).toBeNull();
  });

  it('shows the field until the ledger read of a funded debit lands, then not', async () => {
    const rendered = await open(routeOf(), { ...FUNDED_DEBIT, fundingLedger: [] });

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(rendered.queryByText(CAPTION)).toBeNull();

    mockWorld.fundingLedger = FUNDED_DEBIT.fundingLedger ?? [];
    await act(async () => {
      await rendered.rerender(formElement(routeOf()));
    });

    expect(rendered.getByText(CAPTION)).toBeTruthy();
    expect(rendered.queryByLabelText(FIELD_LABEL)).toBeNull();
  });
});

describe('the reads on mount', () => {
  const newTransactionReads = () =>
    mockLive.calls.filter(
      ({ kind, tables, enabled }) =>
        enabled && tables[0] === 'transactions' && !READS_BEFORE_THE_FIELD.includes(kind ?? ''),
    );

  it('reads no new transactions query when no mark lies under the key and currency', async () => {
    const rendered = await open(routeOf());

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(newTransactionReads()).toEqual([]);
  });

  it('reads none for a mark in another currency, and the field still shows', async () => {
    mockLive.reads.settings = {
      rows: netflixSettingsOf({ marks: [markOf('monthly', 14_400, 'USD')] }),
      isLoading: false,
      error: undefined,
    };

    const rendered = await open(routeOf());

    expect(rendered.getByLabelText(FIELD_LABEL)).toBeTruthy();
    expect(newTransactionReads()).toEqual([]);
  });

  it('reads the whole ledger once for a mark in the row currency', async () => {
    mockLive.reads.settings = {
      rows: netflixSettingsOf({ marks: [markOf('monthly', 14_400)] }),
      isLoading: false,
      error: undefined,
    };

    await open(routeOf());

    expect(newTransactionReads().map(({ kind }) => kind)).toContain('recurringLedger');
  });
});
