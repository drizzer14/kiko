import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { darkTheme } from '@kiko/design-system/theme';
import { holdingTypes } from '@kiko/holdings/holding-type';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Overrides
// ONLY `useAnimatedRef` — see the module for the full rationale.
import { mockReanimatedScrollToEnd } from '@kiko/test-support/mock-reanimated-scroll-to-end';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TransactionFormScreen, { canSaveSplit } from './transaction-form.screen';

const mockScrollToEnd = jest.fn();

jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd));
// `addReturn` routes through the SAME
// occlusion-aware `scrollToField` helper the Save-invalid path already uses
// (see holding-form.screen.test.tsx for the identical pattern), rather than
// an unconditional `scrollToEnd` — auto-mocked here so the new-row tests
// below can assert on the WIRING without depending on real
// `measureLayout`/`measure` host-instance behavior under the test renderer.
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

type TransactionFormProps = ComponentProps<typeof TransactionFormScreen>;

const transactionFormRoute = (params: TransactionFormParams) =>
  asRouteProp<TransactionFormProps['route']>('TransactionForm', params);

// A react-test-renderer JSON node's `children` mixes further nodes and raw
// text leaves. Walking only `children` (never `props`) and keeping just the
// string leaves reconstructs the SCREEN-READING order of every rendered
// caption/label/button-text, independent of any prop value (e.g. a
// `placeholder` that happens to equal a neighboring field's label) — used to
// assert field order without depending on internal DOM structure.
type RenderedNode = { children: (RenderedNode | string)[] | null };

const collectRenderedText = (node: RenderedNode | string | null): string[] => {
  if (node === null) {
    return [];
  }

  if (typeof node === 'string') {
    return [node];
  }

  return (node.children ?? []).flatMap(collectRenderedText);
};

const mockRecordManual = jest.fn();
const mockRecordManualWithReturns = jest.fn();
const mockRecordExchange = jest.fn();
const mockRecordExchangeCounterpart = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockUpsertCategoryOverride = jest.fn();
const mockSetCategory = jest.fn();
const mockSetLoanPayment = jest.fn();
const mockUndoAutoLoanLink = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...args),
    recordManualWithReturns: (...args: unknown[]) => mockRecordManualWithReturns(...args),
    recordExchange: (...args: unknown[]) => mockRecordExchange(...args),
    recordExchangeCounterpart: (...args: unknown[]) => mockRecordExchangeCounterpart(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    setCategory: (...args: unknown[]) => mockSetCategory(...args),
    setLoanPayment: (...args: unknown[]) => mockSetLoanPayment(...args),
    undoAutoLoanLink: (...args: unknown[]) => mockUndoAutoLoanLink(...args),
    getByIdQuery: (transactionId: string) => ({
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
    // Tagged so the `useLiveQuery` mock can tell this `['transactions']`-keyed
    // subscription apart from the by-id one and serve the past-description
    // suggestion list to it.
    distinctDescriptionsQuery: () => ({
      __kind: 'distinctDescriptions',
      toSQL: () => ({ sql: '', params: [] }),
    }),
    // Tagged for the same reason: the empty-create default-holding seam reads
    // the newest manual row's holding through this `['transactions']`-keyed
    // subscription, disambiguated from the by-id and past-description-suggestion ones.
    latestManualHoldingQuery: () => ({
      __kind: 'latestManualHolding',
      toSQL: () => ({ sql: '', params: [] }),
    }),
    // Tagged because it shares the `['holdings']` key with the holdings list.
    balanceBoundaryQuery: (holdingId: string) => ({
      __kind: 'balanceBoundary',
      toSQL: () => ({ sql: '', params: [holdingId] }),
    }),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/category-overrides-repo', () => ({
  categoryOverridesRepo: {
    upsertCategoryOverride: (...args: unknown[]) => mockUpsertCategoryOverride(...args),
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

type Holding = {
  id: string;
  currency: string;
  balanceMinorUnits: number;
  type?: string;
  name?: string;
  closedAt?: number | null;
  icon?: string | null;
  color?: string | null;
  accountId?: string;
  sortOrder?: number;
  createdAt?: number;
  metadata?: unknown;
};
type Account = {
  id: string;
  name: string;
  institution?: string | null;
  kind?: string;
  archivedAt?: number | null;
};
type Category = { key: string; title: string; icon: string };
type Transaction = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  source: 'manual' | 'monobank' | 'binance';
  category?: string | null;
  comment?: string | null;
  loanHoldingId?: string | null;
  loanLinkSource?: 'auto' | 'manual' | null;
  exchangeCounterpartHoldingId?: string | null;
  changeGroupId?: string | null;
  setsBalance?: boolean;
};
type BalanceBoundarySources = { balanceSetAt: number | null; newestSyncTime: number | null };

// The category options the picker renders in every test; a stable set so the
// "category editing" cases can press a chip by its title.
const CATEGORIES: Category[] = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

type Rate = { base: string; quote: string; rate: string };
type OverrideRule = { normalizedName: string; category: string };

const setLiveData = (
  holdings: Holding[],
  transaction?: Transaction,
  categories: Category[] = CATEGORIES,
  accounts: Account[] = [],
  rates: Rate[] = [],
  overrideRules: OverrideRule[] = [],
  pastDescriptions: string[] = [],
  latestManualHoldingId: string | null = null,
  balanceBoundary: BalanceBoundarySources | null = null,
): void => {
  const dataByTable: Record<string, unknown[]> = {
    holdings,
    transactions: transaction ? [transaction] : [],
    categories,
    accounts,
    currency_rates: rates,
    category_overrides: overrideRules,
  };

  mockUseLiveQuery.mockImplementation((query: unknown, tables: string[]) => {
    const kind = (query as { __kind?: string })?.__kind;
    // The distinct-descriptions subscription shares the `['transactions']`
    // key with the by-id lookup, so it is disambiguated by the tagged query
    // object the mocked repo returns.
    if (kind === 'distinctDescriptions') {
      return { data: pastDescriptions.map((description) => ({ description })) };
    }

    // The B empty-create default-holding seam reads the newest manual row's
    // holding through its own tagged `['transactions']`-keyed subscription.
    if (kind === 'latestManualHolding') {
      return {
        data: latestManualHoldingId ? [{ holdingId: latestManualHoldingId }] : [],
        isLoading: false,
      };
    }

    if (kind === 'balanceBoundary') {
      return { data: balanceBoundary ? [balanceBoundary] : [] };
    }

    return { data: dataByTable[tables[0]] ?? [] };
  });
};

const navigation = navigationSpy();
const navigationProp = asNavigationProp<TransactionFormProps['navigation']>(navigation);

const renderAddFromHolding = (holdingId: string): ReturnType<typeof render> => {
  const route = transactionFormRoute({ holdingId });

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

const renderAdd = (): ReturnType<typeof render> => renderAddFromHolding('h1');

const renderEdit = (transactionId: string): ReturnType<typeof render> => {
  const route = transactionFormRoute({ transactionId });

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

const renderDuplicate = (duplicateOfTransactionId: string): ReturnType<typeof render> => {
  const route = transactionFormRoute({ duplicateOfTransactionId });

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

// The B global-add entry: the create form opened with EMPTY params, so no
// holding is fixed by navigation and the form renders its own primary-leg
// holding picker.
const renderEmptyCreate = (): ReturnType<typeof render> => {
  const route = transactionFormRoute({});

  return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
};

// Drive the DateField calendar: open the "Date" sheet, then fire the mocked
// calendar's day-press for the given local day, so a test can backdate a row.
const pickDate = async (
  utils: Awaited<ReturnType<typeof render>>,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Date'));
  await fireEvent(utils.getByTestId('Date calendar'), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
};

// Pick a category from the field's bottom-sheet: tap the field to open the
// sheet, then tap the option row. The picker is a single-select sheet, not an
// inline chip row, so the option is only mounted once the sheet opens. A create
// now requires a category before Save enables, so the add-mode cases pick one
// through the same path the category-editing cases use.
const pickCategory = async (
  utils: Awaited<ReturnType<typeof render>>,
  title: string,
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Category'));
  await fireEvent.press(utils.getByText(title));
};

// ModeSelectField defers its actual `onSelect` call to the next frame (see
// that component's own comment): picking a type closes its sheet immediately,
// but the mode change itself lands a frame later, so the two never share a
// commit. Every test that presses a type-sheet option — through `pickType`
// below or directly, for an assertion that needs the picked mode itself (not
// just the sheet closing) — must flush that deferred frame first.
const flushDeferredModeSelect = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

// Pick a transaction type from the TYPE select field's bottom sheet: tap the
// field (labeled "Type") to open the sheet, then tap the option row. Like the
// category picker, each option is only mounted once the sheet opens (the type
// selector is now a select field, not an inline chip row). `mode` is the
// underlying FormMode value; each row carries a stable
// `transaction-type-field-option-<mode>` testID so the tap never collides with the
// trigger's own selected-value text.
const pickType = async (
  utils: Awaited<ReturnType<typeof render>>,
  mode: 'income' | 'expense' | 'exchange' | 'split',
): Promise<void> => {
  await fireEvent.press(utils.getByLabelText('Type'));
  await fireEvent.press(utils.getByTestId(`transaction-type-field-option-${mode}`));
  await flushDeferredModeSelect();
};

describe('TransactionFormScreen — add mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderAdd();
    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add transaction" is now the single title;
    // the in-body duplicate is gone.
    expect(queryByText('Add transaction')).toBeNull();
  });

  it('sets the header title to "Add Transaction"', async () => {
    await renderAdd();
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Transaction' });
  });

  it('marks Amount and Category required on a fresh add', async () => {
    const { getAllByText } = await renderAdd();

    // A create gates save on a positive amount AND a picked category, so both
    // show the required asterisk; description, date, and time do not. The marker
    // is hidden from accessibility, so the query includes hidden elements.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('submits a manual transaction', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    // Create defaults to the Expense chip (see "defaults to expense" tests
    // below), so an untouched chip writes a negative amount.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({
        holdingId: 'h1',
        amountMinorUnits: -1234,
        description: 'Coffee',
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('records one transaction for a double-tapped Save', async () => {
    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so.
    let resolveWrite: () => void = () => {};
    mockRecordManual.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    // Leave the description blank: a non-blank description picks the
    // category-override confirm sheet path (see "skips the override sheet
    // entirely when the description is blank" above), which needs its own
    // "Apply" tap and would make this test about the override flow instead of
    // the double-tap guard.
    await pickCategory(utils, 'Groceries');

    const save = getByText('Save');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(mockRecordManual).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockRecordManual).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this file's beforeEach) clears call history but
    // not a custom mockImplementation — reset it explicitly so it does not
    // leak this test's never-auto-resolving write into the next test.
    mockRecordManual.mockReset();
  });

  it('negates the amount for an expense', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await pickType(utils, 'expense');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h1', amountMinorUnits: -1000 }),
    );
  });

  it('shows the income/expense type in the select sheet with expense selected by default', async () => {
    const utils = await renderAdd();
    const { getByRole } = utils;
    // The type selector is now a select field opening a bottom sheet of option
    // rows; expense is the default selection (most manual entries are spending)
    // and income is not. The option rows only mount once the sheet opens.
    await fireEvent.press(utils.getByLabelText('Type'));
    expect(getByRole('button', { name: 'Expense' }).props.accessibilityState.selected).toBe(true);
    expect(getByRole('button', { name: 'Income' }).props.accessibilityState.selected).toBe(false);
  });

  it('renders the type glyphs: income points DOWN and expense points UP', async () => {
    const utils = await renderAdd();

    // Open the type sheet so both option rows mount. The mocked SFSymbolView
    // forwards `name` to a host View, so each row's glyph name shows in the
    // tree. The up/down asymmetry is spec-mandated (money leaving vs. arriving)
    // — do not "fix" it.
    await fireEvent.press(utils.getByLabelText('Type'));
    const tree = JSON.stringify(utils.toJSON());
    expect(tree).toContain('arrow.down');
    expect(tree).toContain('arrow.up');
  });

  it('treats a fresh create amount as negative (expense) without touching the type field', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '10.00');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h1', amountMinorUnits: -1000 }),
    );
  });

  it('backdates a manual transaction to the picked day, keeping the default time-of-day', async () => {
    // A fresh add defaults `time` to now; picking a DAY moves only the day and
    // carries over that default time-of-day (the DateField no longer resets to
    // midnight, so a later time pick is not clobbered). Pin `Date.now()` so the
    // carried-over time-of-day (14:30) is deterministic.
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2025, 2, 15, 14, 30, 0).getTime());
    const utils = await renderAdd();
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await pickDate(utils, 2025, 2, 1);
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 1, 1, 14, 30, 0).getTime() }),
    );
    nowSpy.mockRestore();
  });

  it('caps the Date calendar at today, so the form cannot take a future day', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2025, 2, 15, 14, 30, 0).getTime());
    const utils = await renderAdd();
    await fireEvent.press(utils.getByLabelText('Date'));

    expect(utils.getByTestId('Date calendar').props.maxDate).toBe('2025-03-15');
    nowSpy.mockRestore();
  });

  it('groups the amount with spaces as the user types and still parses it on save', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '1000000');
    // The field reflects the grouped display value immediately as typed.
    expect(getByLabelText('Amount').props.value).toBe('1 000 000');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    // The grouped string round-trips through parseAmount: 1,000,000.00 UAH,
    // negated by the Expense default.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: -100_000_000 }),
    );
  });

  it('does not submit when the amount is empty', async () => {
    const { getByLabelText, getByText } = await renderAdd();
    await fireEvent.changeText(getByLabelText('Description'), 'No amount');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('does not write a zero-amount row', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('does not write a 0.00 row', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0.00');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('still writes the smallest representable amount', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0.01');
    await pickType(utils, 'expense');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: -1 }),
    );
  });

  it('does not save for a zero amount, keeping Save enabled and showing the reason after a press', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText, getByTestId } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '0');
    await pickCategory(utils, 'Groceries');

    expect(getByText('Save').parent?.props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).not.toHaveBeenCalled();
    expect(getByText('Amount must be greater than 0.')).toBeTruthy();
    // The reason moved onto the Amount field, so the footer no longer carries
    // it — see the "renders only the Save button in the footer" test below.
    expect(
      within(getByTestId('screen-footer')).queryByText('Amount must be greater than 0.'),
    ).toBeNull();
    const flatStyle = StyleSheet.flatten(getByLabelText('Amount').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows an inline reason for a fresh add missing amount and category, only after Save is pressed', async () => {
    const utils = await renderAdd();

    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();

    await fireEvent.press(utils.getByText('Save'));
    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(
      within(utils.getByTestId('screen-footer')).queryByText('Amount must be greater than 0.'),
    ).toBeNull();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
    expect(utils.getByText('Select a category.')).toBeTruthy();
    expect(within(utils.getByTestId('screen-footer')).queryByText('Select a category.')).toBeNull();

    await pickCategory(utils, 'Groceries');
    expect(utils.queryByText('Select a category.')).toBeNull();
  });

  it('shows the amount and category errors together at the same Save press, each clearing only its own field', async () => {
    const utils = await renderAdd();

    await fireEvent.press(utils.getByText('Save'));

    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(utils.getByText('Select a category.')).toBeTruthy();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');

    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
    expect(utils.getByText('Select a category.')).toBeTruthy();

    await pickCategory(utils, 'Groceries');

    expect(utils.queryByText('Select a category.')).toBeNull();
  });

  it('turns the Category label red with its error, and back once a category is picked', async () => {
    const utils = await renderAdd();

    expect(isLabelInvalid(mockFieldLabel, 'Category')).toBe(false);

    await fireEvent.press(utils.getByText('Save'));

    expect(isLabelInvalid(mockFieldLabel, 'Category')).toBe(true);

    await pickCategory(utils, 'Groceries');

    expect(isLabelInvalid(mockFieldLabel, 'Category')).toBe(false);
  });

  it('adds the same vertical gap above the category error that a text field has above its own', async () => {
    const utils = await renderAdd();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await fireEvent.press(utils.getByText('Save'));

    // A select field's error needs the same gap TextField's own `Box gap={1}`
    // already gives its error line.
    const errorGroup = utils.getByText('Select a category.').parent?.parent;
    expect(StyleSheet.flatten(errorGroup?.props.style).gap).toBe(darkTheme.spacing(1));
  });

  it('renders only the Save button in the footer — no reason line, on any blocked path', async () => {
    const utils = await renderAdd();
    await fireEvent.press(utils.getByText('Save'));

    const footer = utils.getByTestId('screen-footer');
    expect(within(footer).getByText('Save')).toBeTruthy();
    expect(within(footer).queryByText(/./)).toEqual(within(footer).getByText('Save'));
  });

  it('writes the picked category onto the row even with a blank description', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries', description: '' }),
    );
  });

  it('skips the override sheet entirely when the description is blank', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText, queryByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    expect(queryByText(/Apply/)).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('keeps the row categorised when the user cancels the override sheet', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'ATB');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries' }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
  });

  it('renders the type selector directly under the Holding select, above Amount: Type, Amount, Description, Date, Time, Category', async () => {
    const utils = await renderAdd();
    const rendered = collectRenderedText(utils.toJSON());
    // The transaction-TYPE selector is now a select field rendered directly
    // UNDER the Holding select (absent here — renderAdd fixes the holding by
    // navigation), so its 'Type' caption leads the field group: above Amount,
    // Description, Date, Time, and the Category picker.
    const order = ['Type', 'Amount', 'Description', 'Date', 'Time', 'Category'].map((label) =>
      rendered.indexOf(label),
    );

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('surfaces an alert and does not navigate when the write fails', async () => {
    mockRecordManual.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('TransactionFormScreen — category pre-select from name rules (A1)', () => {
  // A single rule mapping the normalized description "coffee" to the Dining
  // category, so a create whose description settles to "Coffee" auto-picks it.
  const COFFEE_RULE: OverrideRule = { normalizedName: 'coffee', category: 'dining' };

  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(
      [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }],
      undefined,
      CATEGORIES,
      [],
      [],
      [COFFEE_RULE],
    );
  });

  it('pre-selects the matching rule category when the description blurs on a create', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    // The lookup fires on BLUR, not on keystroke, and satisfies the create-time
    // category requirement without a manual pick.
    await fireEvent(getByLabelText('Description'), 'blur');
    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Coffee', category: 'dining' }),
    );
  });

  it('does not overwrite an explicit picker choice with a later matching blur', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    // Explicit pick first, then a description that WOULD match a different rule.
    await pickCategory(utils, 'Groceries');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    await fireEvent(getByLabelText('Description'), 'blur');
    await fireEvent.press(getByText('Save'));

    // The user's Groceries pick is preserved — the blur never clobbers it.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Coffee', category: 'groceries' }),
    );
  });

  it('re-nulls the auto-pick so the category reason reappears when the name settles to a non-match', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText, queryByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Coffee');
    await fireEvent(getByLabelText('Description'), 'blur');
    await fireEvent.press(getByText('Save'));
    // The auto-pick supplied a category, so this first press actually wrote —
    // no reason for it.
    expect(queryByText('Select a category.')).toBeNull();

    // A name matching no rule clears the auto-pick, so a SECOND attempted Save
    // is blocked again and shows the category reason.
    await fireEvent.changeText(getByLabelText('Description'), 'Unmatched name');
    await fireEvent(getByLabelText('Description'), 'blur');
    await fireEvent.press(getByText('Save'));

    expect(getByText('Select a category.')).toBeTruthy();
  });
});

describe('TransactionFormScreen — description suggestions', () => {
  // One name rule ("coffee" -> Dining) plus a pool of past MANUAL descriptions,
  // so a tapped suggestion can be shown to BOTH fill the field and re-seat A1's
  // rule category through the ONE shared description-handling surface.
  const COFFEE_RULE: OverrideRule = { normalizedName: 'coffee', category: 'dining' };
  const PAST = ['Coffee', 'Groceries run'];

  const seed = (transaction?: Transaction): void =>
    setLiveData(
      [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }],
      transaction,
      CATEGORIES,
      [],
      [],
      [COFFEE_RULE],
      PAST,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    seed();
  });

  it('surfaces a matching past description as the user types on create', async () => {
    const { getByLabelText, getByText } = await renderAdd();

    await fireEvent.changeText(getByLabelText('Description'), 'Cof');

    // The past "Coffee" row is offered as a tappable suggestion chip.
    expect(getByText('Coffee')).toBeTruthy();
  });

  it('offers no suggestion when the typed value matches no past description', async () => {
    const { getByLabelText, queryByText } = await renderAdd();

    await fireEvent.changeText(getByLabelText('Description'), 'Zzz');

    expect(queryByText('Coffee')).toBeNull();
  });

  it('fills the description and re-seats the rule category when a suggestion is tapped', async () => {
    const utils = await renderAdd();
    const { getByLabelText, getByText } = utils;
    await fireEvent.changeText(getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(getByLabelText('Description'), 'Cof');

    // Tapping the suggestion fills the field verbatim AND re-fires A1's rule
    // lookup (coffee -> dining) through the same shared handler, so Save writes
    // both without a manual category pick.
    await fireEvent.press(getByText('Coffee'));
    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Coffee', category: 'dining' }),
    );
  });

  it('does not surface suggestions on an edit', async () => {
    seed({
      id: 't1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 0,
      description: 'Cof',
      source: 'manual',
    });

    const { queryByText } = await renderEdit('t1');

    // An edit already has its description, so the suggestion row never shows —
    // even though the hydrated "Cof" would otherwise match the past "Coffee".
    expect(queryByText('Coffee')).toBeNull();
  });
});

describe('TransactionFormScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the income/expense/category field chrome from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText, getAllByText, queryByText } = await renderAdd();

    expect(getByLabelText('Сума')).toBeTruthy();
    expect(getByLabelText('Опис')).toBeTruthy();
    // The type selector is a select field labeled 'Тип' from the uk catalog;
    // its option labels only mount once the sheet opens. 'Дохід' (income) is a
    // sheet option only; 'Витрата' (expense, the default) shows on BOTH the
    // trigger and its sheet row, so it matches more than once.
    expect(getByLabelText('Тип')).toBeTruthy();
    await fireEvent.press(getByLabelText('Тип'));
    expect(getByText('Дохід')).toBeTruthy();
    expect(getAllByText('Витрата').length).toBeGreaterThan(0);
    expect(getByLabelText('Категорія')).toBeTruthy();
    expect(queryByText('Amount')).toBeNull();
  });

  it('renders the Exchange field group and Save from the Ukrainian catalog', async () => {
    setLiveData([
      { id: 'cash-1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Cash UAH' },
      { id: 'card-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'card', name: 'Card USD' },
    ]);
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText } = await renderAddFromHolding('cash-1');
    // The type selector is a select field labeled 'Тип' from the uk catalog;
    // open it, then pick the Exchange ('Обмін') option row.
    await fireEvent.press(getByLabelText('Тип'));
    await fireEvent.press(getByText('Обмін'));
    await flushDeferredModeSelect();

    expect(getByLabelText('Віддано')).toBeTruthy();
    expect(getByLabelText('Куди')).toBeTruthy();
    expect(getByLabelText('Отримано')).toBeTruthy();
    expect(getByText('Зберегти')).toBeTruthy();
  });
});

describe('TransactionFormScreen — duplicate mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'cash' }], {
      id: 'txn-src',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      category: 'groceries',
      source: 'manual',
    });
  });

  it('opens the CREATE form (title "Add Transaction"), not an edit of the source', async () => {
    await renderDuplicate('txn-src');
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Transaction' });
  });

  it('seeds amount, description, and category from the source row', async () => {
    const { getByLabelText, getByText } = await renderDuplicate('txn-src');

    expect(getByLabelText('Amount').props.value).toBe('12.34');
    expect(getByLabelText('Description').props.value).toBe('Coffee');
    // The source's category seeds the picker, so Save is enabled immediately
    // (a create requires a category) — the picked title shows on the field.
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('writes a NEW row via recordManual, dated to NOW (never the source time), leaving the source untouched', async () => {
    const before = Date.now();
    const { getByText } = await renderDuplicate('txn-src');

    await fireEvent.press(getByText('Save'));

    // A duplicate re-invokes the create path (recordManual), never the edit
    // (update) or delete (remove) paths, so the source row is left intact.
    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({
        holdingId: 'h1',
        amountMinorUnits: -1234,
        description: 'Coffee',
        category: 'groceries',
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();

    // Dated to NOW: the write's time is a fresh timestamp, not the source's 42.
    const { time } = mockRecordManual.mock.calls[0][0] as { time: number };
    expect(time).not.toBe(42);
    expect(time).toBeGreaterThanOrEqual(before);
  });

  it('seeds the holding (and thus the amount currency) from the source row via the primary-holding seam', async () => {
    // A BTC source proves the holding seam drives the currency scale: the same
    // -50 minor units that would render as "57" under a mis-scaled currency
    // renders 0.0000005 only when the holding — hence BTC's 8dp scale — is
    // correctly seeded from the source row.
    setLiveData([{ id: 'h-btc', currency: 'BTC', balanceMinorUnits: 0, type: 'crypto_asset' }], {
      id: 'txn-btc',
      holdingId: 'h-btc',
      amountMinorUnits: -50,
      time: 42,
      description: 'Sats',
      category: 'groceries',
      source: 'manual',
    });

    const { getByLabelText, getByText } = await renderDuplicate('txn-btc');

    expect(getByLabelText('Amount').props.value).toBe('0.0000005');

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h-btc', amountMinorUnits: -50 }),
    );
  });

  it('preserves the seeded category when the pre-filled description is edited to a no-rule name and blurs', async () => {
    // The classic "duplicate this row, tweak the note" flow: the source seeds
    // Groceries, then the user retypes the description to a name matching NO
    // rule and blurs. A duplicate-seeded category is treated as a user pick, so
    // the blur (A1) must NOT clear it — the category stays and Save stays on.
    const utils = await renderDuplicate('txn-src');
    const { getByLabelText, getByText } = utils;

    await fireEvent.changeText(getByLabelText('Description'), 'Unmatched name');
    await fireEvent(getByLabelText('Description'), 'blur');

    // The seeded Groceries category survives the blur (chip still shown)...
    expect(getByText('Groceries')).toBeTruthy();
    // ...and Save stays enabled (a create needs a category).
    expect(getByText('Save').parent?.props.accessibilityState.disabled).toBe(false);
  });
});

describe('TransactionFormScreen — empty-create / global add (B)', () => {
  // Two eligible cash holdings on two accounts, plus a synced holding and a
  // bond/property_item that the primary picker must EXCLUDE (the
  // 'transaction' gate: open, non-synced, non-ledgerless — see
  // `isLedgerlessHoldingType`).
  const HOLDINGS = [
    {
      id: 'h1',
      currency: 'UAH' as const,
      balanceMinorUnits: 0,
      type: 'cash',
      name: 'Wallet',
      accountId: 'a1',
      sortOrder: 0,
      createdAt: 1,
    },
    {
      id: 'h2',
      currency: 'USD' as const,
      balanceMinorUnits: 0,
      type: 'card',
      name: 'Card',
      accountId: 'a2',
      sortOrder: 0,
      createdAt: 2,
    },
    {
      id: 'h-bond',
      currency: 'UAH' as const,
      balanceMinorUnits: 0,
      type: 'bond',
      name: 'War Bond',
      accountId: 'a1',
      sortOrder: 1,
      createdAt: 3,
    },
    {
      id: 'h-property',
      currency: 'UAH' as const,
      balanceMinorUnits: 0,
      type: 'property_item',
      name: 'Flat',
      accountId: 'a1',
      sortOrder: 2,
      createdAt: 4,
    },
  ];
  const ACCOUNTS: Account[] = [
    { id: 'a1', name: 'Cash' },
    { id: 'a2', name: 'Bank' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the primary-leg holding picker (no fixed holding from navigation)', async () => {
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS);

    const { getByLabelText } = await renderEmptyCreate();

    // The shared HoldingSelectField labeled "Holding" is the primary-leg picker.
    expect(getByLabelText('Holding')).toBeTruthy();
  });

  // The currency glyph renders as a Text inside the field's own container (a
  // suffix slot), not as a prop — scoped to the Amount field so it can't pass by
  // matching another leg's suffix.
  const amountSuffixWithin = (
    utils: Awaited<ReturnType<typeof render>>,
  ): ReturnType<typeof within> => {
    const field = utils.getByLabelText('Amount').parent;

    if (field === null) {
      throw new Error('Amount field has no container');
    }

    return within(field);
  };

  it("defaults the primary holding to the MOST RECENT manual row's holding", async () => {
    // h2 (USD) is the newest manual holding, so the amount field carries the
    // USD glyph — proving the seam derived the currency from the seeded holding.
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h2');

    const utils = await renderEmptyCreate();

    expect(amountSuffixWithin(utils).getByText('$')).toBeTruthy();
  });

  it('falls back to the first eligible holding when there is no manual history', async () => {
    // No most-recent-manual holding, so the first Accounts-ordered eligible
    // option (h1, UAH) seeds the seam — its currency glyph shows on Amount.
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], null);

    const utils = await renderEmptyCreate();

    expect(amountSuffixWithin(utils).getByText('₴')).toBeTruthy();
  });

  it('excludes bond and property_item holdings from the picker (the transaction gate)', async () => {
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h1');

    const { getByLabelText, queryByLabelText } = await renderEmptyCreate();

    // Open the picker sheet.
    await fireEvent.press(getByLabelText('Holding'));

    // The two eligible holdings are offered as option rows (each labeled
    // "<name>, <account>"); the bond and the property_item are not — both are
    // ledgerless (isLedgerlessHoldingType), the same 'transaction' gate
    // `holdingDetailSpecs` applies.
    expect(getByLabelText('Wallet, Cash')).toBeTruthy();
    expect(getByLabelText('Card, Bank')).toBeTruthy();
    expect(queryByLabelText('War Bond, Cash')).toBeNull();
    expect(queryByLabelText('Flat, Cash')).toBeNull();
  });

  it('writes a create against the PICKED holding via recordManual', async () => {
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h1');

    const utils = await renderEmptyCreate();
    const { getByLabelText, getByText } = utils;

    // Re-point the primary leg to the USD card through the picker (the option
    // row's accessibility label is "<name>, <account>").
    await fireEvent.press(getByLabelText('Holding'));
    await fireEvent.press(getByLabelText('Card, Bank'));

    await fireEvent.changeText(getByLabelText('Amount'), '12.00');
    await pickCategory(utils, 'Groceries');

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ holdingId: 'h2', category: 'groceries' }),
    );
  });

  it('surfaces the Exchange type option once a cash primary holding is active', async () => {
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h1');

    const utils = await renderEmptyCreate();

    // A cash source enables the create-only Exchange mode (resolveModeOptions
    // keys off the picked holding's type), so the option appears in the type
    // select sheet once it is opened.
    await fireEvent.press(utils.getByLabelText('Type'));
    expect(utils.getByText('Exchange')).toBeTruthy();
  });

  it('does not surface the Exchange type option when the primary holding is a crypto_asset', async () => {
    // A crypto_asset holding (e.g. one migration 0044 moved a cash holding
    // onto) is no longer an exchange SOURCE — `cryptoAssetDescriptor`'s
    // `exchange.createSource` is `false`, unlike the cash holding it may have
    // come from.
    const cryptoHoldings = [
      {
        id: 'h-crypto',
        currency: 'BTC' as const,
        balanceMinorUnits: 0,
        type: 'crypto_asset',
        name: 'Cold wallet',
        accountId: 'a1',
        sortOrder: 0,
        createdAt: 1,
      },
    ];
    setLiveData(cryptoHoldings, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h-crypto');

    const utils = await renderEmptyCreate();

    // Proves h-crypto (BTC) really is the seeded primary holding, before
    // asserting on the Exchange option that follows FROM its type.
    expect(amountSuffixWithin(utils).getByText('₿')).toBeTruthy();

    await fireEvent.press(utils.getByLabelText('Type'));
    expect(utils.queryByText('Exchange')).toBeNull();
  });

  it('renders the Exchange and Split type glyphs once the extra modes surface', async () => {
    setLiveData(HOLDINGS, undefined, CATEGORIES, ACCOUNTS, [], [], [], 'h1');

    const utils = await renderEmptyCreate();

    // Exchange and Split appear together off a cash source; open the type sheet
    // so their option rows mount, then their glyphs render via the mocked
    // SFSymbolView.
    await fireEvent.press(utils.getByLabelText('Type'));
    const tree = JSON.stringify(utils.toJSON());
    expect(tree).toContain('arrow.left.arrow.right');
    expect(tree).toContain('arrow.trianglehead.branch');
  });
});

describe('TransactionFormScreen — edit mode (manual)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });
  });

  it('sets the header title to "Edit Transaction"', async () => {
    await renderEdit('txn-1');
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Transaction' });
  });

  it('pre-fills the amount, description and sign from the existing transaction', async () => {
    const { getByLabelText } = await renderEdit('txn-1');
    expect(getByLabelText('Amount').props.value).toBe('12.34');
    expect(getByLabelText('Description').props.value).toBe('Coffee');
    // A negative stored amount pre-selects the Expense sign.
    expect(getByLabelText('Amount').props.editable).not.toBe(false);
  });

  it('opens an income row selected in the type sheet, not the create-mode Expense default', async () => {
    // Regression guard for the A2 default flip: the hydrate effect's
    // `setMode(fields.sign)` must still win for an existing positive
    // (income) row, even though a fresh create now defaults to Expense.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-income',
      holdingId: 'h1',
      amountMinorUnits: 1234,
      time: 42,
      description: 'Salary',
      source: 'manual',
    });
    const utils = await renderEdit('txn-income');
    // Open the type sheet so its option rows mount, then assert the hydrated
    // selection landed on Income (not the create default of Expense).
    await fireEvent.press(utils.getByLabelText('Type'));
    const { getByRole } = utils;
    expect(getByRole('button', { name: 'Income' }).props.accessibilityState.selected).toBe(true);
    expect(getByRole('button', { name: 'Expense' }).props.accessibilityState.selected).toBe(false);
  });

  it('hydrates a 50-satoshi BTC transaction to 0.0000005, not 57', async () => {
    // Below 100 satoshis, `String(minor / 1e8)` emits exponential notation
    // ("5e-7"), which the grouping formatter used to strip down to its digits
    // ("57") — a 50-satoshi transaction rendered, and saved, as 57 BTC.
    setLiveData([{ id: 'h-btc', currency: 'BTC', balanceMinorUnits: 0, type: 'crypto_asset' }], {
      id: 'tx-1',
      holdingId: 'h-btc',
      amountMinorUnits: -50,
      time: 0,
      description: '',
      source: 'manual',
    });

    const { getByLabelText } = await renderEdit('tx-1');

    expect(getByLabelText('Amount').props.value).toBe('0.0000005');
  });

  it('calls update (not recordManual) with the transaction id and edited amount on save', async () => {
    const { getByLabelText, getByText } = await renderEdit('txn-1');
    await fireEvent.changeText(getByLabelText('Amount'), '20.00');
    await fireEvent.press(getByText('Save'));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'txn-1',
        // Still an expense: -20.00 UAH.
        amountMinorUnits: -2000,
      }),
    );
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('keeps Save enabled but blocks the write and shows the reason when the amount is cleared on an edit', async () => {
    const utils = await renderEdit('txn-1');
    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;

    expect(isSaveDisabled()).toBe(false);

    await fireEvent.changeText(utils.getByLabelText('Amount'), '');
    expect(isSaveDisabled()).toBe(false);

    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(
      within(utils.getByTestId('screen-footer')).queryByText('Amount must be greater than 0.'),
    ).toBeNull();
  });

  it('persists the existing time unchanged when the date is not edited', async () => {
    const { getByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Save'));
    // The stored time (42) hydrates the DateField and round-trips on save,
    // rather than being reset to Date.now().
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ time: 42 }));
  });

  it('keeps a stored future date when the date is not touched', async () => {
    const now = new Date(2026, 9, 5, 14, 30, 0).getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const future = new Date(2026, 9, 20, 9, 15, 0).getTime();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: future,
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');

    expect(utils.getByText(formatDate(future))).toBeTruthy();
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ time: future }));
    nowSpy.mockRestore();
  });

  it('keeps a stored date of today unchanged', async () => {
    const now = new Date(2026, 9, 5, 14, 30, 0).getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const laterToday = new Date(2026, 9, 5, 21, 0, 0).getTime();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: laterToday,
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ time: laterToday }));
    nowSpy.mockRestore();
  });

  it('re-dates the transaction to a newly picked calendar day, keeping its time-of-day', async () => {
    // A stored row at 09:15 on 20 June 2024; re-picking only the day must move
    // the day and carry over the 09:15 time-of-day (so a later time pick is not
    // lost), rather than resetting to midnight.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');
    await pickDate(utils, 2025, 1, 10);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2025, 0, 10, 9, 15, 0).getTime() }),
    );
  });

  it('re-times the transaction to a newly picked time, keeping its day', async () => {
    // A stored row at 09:15 on 20 June 2024; picking only the TIME must keep the
    // 20 June 2024 day while replacing the time-of-day with 18:45.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const utils = await renderEdit('txn-1');
    await fireEvent.press(utils.getByLabelText('Time'));
    await fireEvent(
      utils.getByTestId('Time picker'),
      'change',
      { type: 'set' },
      new Date(2000, 0, 1, 18, 45),
    );
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2024, 5, 20, 18, 45).getTime() }),
    );
  });

  it('opening an existing transaction shows its stored time-of-day, not the wall clock', async () => {
    // The edit screen hydrates `time` from the stored row (09:15 on 20 June
    // 2024), so the Time field shows 09:15 — never the current wall-clock time.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: new Date(2024, 5, 20, 9, 15, 0).getTime(),
      description: 'Coffee',
      source: 'manual',
    });
    const { getByText } = await renderEdit('txn-1');

    expect(getByText('09:15')).toBeTruthy();
  });

  // Deleting a manual transaction is no longer offered from this form — the
  // row's touch-and-hold context menu (`CardContextMenu`) is the only delete
  // entry point now, so the form itself never renders a Delete action or a
  // delete confirm sheet.
  it('offers no Delete action, even on an editable manual transaction', async () => {
    const { queryByText } = await renderEdit('txn-1');

    expect(queryByText('Delete')).toBeNull();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// Before migration 0047 a superseded balance-set row carried no mark, so a
// row saved with no description and no category may be one.
describe('TransactionFormScreen — re-dating a possible balance-set row', () => {
  const BALANCE_SET_AT = new Date(2026, 8, 30, 12, 0).getTime();
  const STORED_TIME = new Date(2026, 8, 10, 9, 15).getTime();

  const possibleBalanceSetRow: Transaction = {
    id: 'old-row',
    holdingId: 'h1',
    amountMinorUnits: 40_000,
    time: STORED_TIME,
    description: '',
    source: 'manual',
    category: null,
    exchangeCounterpartHoldingId: null,
    changeGroupId: null,
    setsBalance: false,
  };

  const editRow = (
    difference: Partial<Transaction> = {},
    balanceBoundary: BalanceBoundarySources = {
      balanceSetAt: BALANCE_SET_AT,
      newestSyncTime: null,
    },
  ): ReturnType<typeof render> => {
    setLiveData(
      [{ id: 'h1', currency: 'UAH', balanceMinorUnits: 100_000, type: 'cash' }],
      { ...possibleBalanceSetRow, ...difference },
      CATEGORIES,
      [],
      [],
      [],
      [],
      null,
      balanceBoundary,
    );

    return renderEdit('old-row');
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('blocks a re-date past the balance set and names the latest time it can take', async () => {
    const utils = await editRow();

    await pickDate(utils, 2026, 10, 5);

    expect(utils.queryByTestId('transaction-time-error')).toBeNull();

    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      within(utils.getByTestId('transaction-time-error')).getByText(
        /^This transaction was saved without a description or category, so it may be an earlier balance change\. Pick a date and time no later than /,
      ),
    ).toBeTruthy();
    expect(utils.getByText(/no later than 30\.09\.2026 /)).toBeTruthy();
  });

  it('turns the Date and Time labels red with the reason', async () => {
    const utils = await editRow();

    await pickDate(utils, 2026, 10, 5);

    expect(isLabelInvalid(mockFieldLabel, 'Date')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Time')).toBe(false);

    await fireEvent.press(utils.getByText('Save'));

    expect(isLabelInvalid(mockFieldLabel, 'Date')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Time')).toBe(true);
  });

  it('clears the reason once the time is moved back, and saves', async () => {
    const utils = await editRow();

    await pickDate(utils, 2026, 10, 5);
    await fireEvent.press(utils.getByText('Save'));
    await pickDate(utils, 2026, 9, 20);

    expect(utils.queryByTestId('transaction-time-error')).toBeNull();
    expect(isLabelInvalid(mockFieldLabel, 'Date')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Time')).toBe(false);

    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2026, 8, 20, 9, 15).getTime() }),
    );
  });

  it('blocks a re-date past the newest synced row', async () => {
    const utils = await editRow(
      {},
      { balanceSetAt: null, newestSyncTime: new Date(2026, 8, 20, 8, 0).getTime() },
    );

    await pickDate(utils, 2026, 9, 25);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(utils.getByText(/no later than 20\.09\.2026 /)).toBeTruthy();
  });

  it.each([
    ['earlier', 2026, 9, 1],
    ['within the history side', 2026, 9, 30],
  ])('saves a re-date %s', async (_name, year, month, day) => {
    const utils = await editRow();

    await pickDate(utils, year, month, day);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(year, month - 1, day, 9, 15).getTime() }),
    );
    expect(utils.queryByTestId('transaction-time-error')).toBeNull();
  });

  it.each([
    ['a marked row', { setsBalance: true }],
    ['a row with a description', { description: 'Salary' }],
    ['a row with a category', { category: 'groceries' }],
  ])('saves %s re-dated past the balance set', async (_name, difference) => {
    const utils = await editRow(difference);

    await pickDate(utils, 2026, 10, 5);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ time: new Date(2026, 9, 5, 9, 15).getTime() }),
    );
  });

  it('shows the reason from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const utils = await editRow();

    await fireEvent.press(utils.getByTestId('transaction-date-field'));
    await fireEvent(utils.getByTestId('Дата calendar'), 'dayPress', {
      year: 2026,
      month: 10,
      day: 5,
      dateString: '2026-10-05',
      timestamp: 0,
    });
    await fireEvent.press(utils.getByText('Зберегти'));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      utils.getByText(
        /^Цю транзакцію збережено без опису й категорії, тож вона може бути давнішою зміною балансу\. Оберіть дату й час не пізніше /,
      ),
    ).toBeTruthy();
    expect(utils.getByText(/не пізніше 30\.09\.2026 /)).toBeTruthy();
  });

  // The boundary matters only for a row the rule can block.
  const boundaryQueryEnabled = (): unknown =>
    mockUseLiveQuery.mock.calls
      .filter(([query]) => (query as { __kind?: string }).__kind === 'balanceBoundary')
      .at(-1)?.[2];

  it('reads the boundary for a row saved with no description or category', async () => {
    await editRow();

    expect(boundaryQueryEnabled()).toBe(true);
  });

  it.each([
    ['a marked row', { setsBalance: true }],
    ['a row with a description', { description: 'Salary' }],
    ['a row with a category', { category: 'groceries' }],
  ])('does not read the boundary for %s', async (_name, difference) => {
    await editRow(difference);

    expect(boundaryQueryEnabled()).toBe(false);
  });

  // A fast Save before the boundary arrives would reach the repo's refusal
  // instead of the field error.
  it('disables Save while the boundary loads', async () => {
    const utils = await editRow();
    const loaded = mockUseLiveQuery.getMockImplementation();

    mockUseLiveQuery.mockImplementation((query: unknown, ...rest: unknown[]) =>
      (query as { __kind?: string }).__kind === 'balanceBoundary'
        ? { data: [], isLoading: true }
        : loaded?.(query, ...rest),
    );
    await utils.rerender(
      <TransactionFormScreen
        route={transactionFormRoute({ transactionId: 'old-row' })}
        navigation={navigationProp}
      />,
    );

    expect(utils.getByText('Save').parent?.props.accessibilityState.disabled).toBe(true);

    await pickDate(utils, 2026, 10, 5);
    await fireEvent.press(utils.getByText('Save'));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('enables Save once the boundary has loaded', async () => {
    const utils = await editRow();

    expect(utils.getByText('Save').parent?.props.accessibilityState.disabled).toBe(false);
  });
});

describe('TransactionFormScreen — blank description pre-fill on edit', () => {
  const holdings: Holding[] = [
    { id: 'h-uah', currency: 'UAH', balanceMinorUnits: 5000, type: 'cash', name: 'Wallet UAH' },
    { id: 'h-usd', currency: 'USD', balanceMinorUnits: 5000, type: 'cash', name: 'Savings USD' },
    { id: 'h-card', currency: 'UAH', balanceMinorUnits: 5000, type: 'card', name: 'Black card' },
  ];

  const leg = (overrides: Partial<Transaction>): Transaction => ({
    id: 'txn-leg',
    holdingId: 'h-uah',
    amountMinorUnits: -1000,
    time: 42,
    description: '',
    source: 'manual',
    exchangeCounterpartHoldingId: null,
    ...overrides,
  });

  // The two legs `recordExchange` writes, and the leg `recordExchangeCounterpart`
  // (Convert) records against an existing income — all store description ''.
  const exchangeLegs: [string, Transaction, string][] = [
    [
      'the outgoing exchange leg',
      leg({ exchangeCounterpartHoldingId: 'h-usd' }),
      'Exchange to Savings USD',
    ],
    [
      'the incoming exchange leg',
      leg({ holdingId: 'h-usd', amountMinorUnits: 500, exchangeCounterpartHoldingId: 'h-uah' }),
      'Exchange from Wallet UAH',
    ],
    [
      'the leg Convert recorded',
      leg({ holdingId: 'h-card', amountMinorUnits: -700, exchangeCounterpartHoldingId: 'h-uah' }),
      'Exchange to Wallet UAH',
    ],
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockSetCategory.mockResolvedValue(undefined);
  });

  it.each(exchangeLegs)('pre-fills %s with the label the list shows', async (_name, row, label) => {
    setLiveData(holdings, row);

    const { getByLabelText } = await renderEdit('txn-leg');

    expect(getByLabelText('Description').props.value).toBe(label);
  });

  it.each(exchangeLegs)('saves %s untouched with an empty description', async (_name, row) => {
    setLiveData(holdings, row);

    const { getByText } = await renderEdit('txn-leg');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-leg', description: '' }),
    );
  });

  it.each(exchangeLegs)('saves the typed text on %s once edited', async (_name, row) => {
    setLiveData(holdings, row);

    const { getByLabelText, getByText } = await renderEdit('txn-leg');
    await fireEvent.changeText(getByLabelText('Description'), 'Rent swap');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'txn-leg', description: 'Rent swap' }),
    );
  });

  it('previews the exchange label as the placeholder once the pre-filled text is cleared', async () => {
    setLiveData(holdings, leg({ exchangeCounterpartHoldingId: 'h-usd' }));

    const { getByLabelText } = await renderEdit('txn-leg');
    await fireEvent.changeText(getByLabelText('Description'), '');

    expect(getByLabelText('Description').props.placeholder).toBe('Exchange to Savings USD');
  });

  it('pre-fills an ordinary blank row with its holding-name label and saves it untouched as empty', async () => {
    setLiveData(holdings, leg({}));

    const { getByLabelText, getByText } = await renderEdit('txn-leg');

    expect(getByLabelText('Description').props.value).toBe('Wallet UAH expense');

    await fireEvent.press(getByText('Save'));

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ description: '' }));
  });

  it('keys a category change on an untouched leg to this row only, not a rule named after the label', async () => {
    setLiveData(holdings, leg({ exchangeCounterpartHoldingId: 'h-usd', category: 'groceries' }));

    const utils = await renderEdit('txn-leg');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    expect(utils.queryByText('Apply Category to All')).toBeNull();
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-leg',
        category: 'dining',
      }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
  });
});

describe('TransactionFormScreen — read-only mode (monobank)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Imported latte',
      source: 'monobank',
    });
  });

  it('sets the header title to "Transaction"', async () => {
    await renderEdit('txn-9');
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Transaction' });
  });

  it('disables the inputs and shows the source-neutral imported explanation', async () => {
    const { getByLabelText, getByText } = await renderEdit('txn-9');
    expect(getByLabelText('Amount').props.editable).toBe(false);
    expect(getByLabelText('Description').props.editable).toBe(false);
    // The notice is source-neutral: it names no single provider, so it reads
    // correctly on a Monobank, Binance or wallet row alike.
    expect(getByText(/was synced/i)).toBeTruthy();
  });

  it('offers no Save action and never writes', async () => {
    const { queryByText } = await renderEdit('txn-9');
    expect(queryByText('Save')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('offers no Delete action for a synced transaction', async () => {
    const { queryByText } = await renderEdit('txn-9');
    expect(queryByText('Delete')).toBeNull();
  });

  it('marks no field required on a read-only synced row', async () => {
    const { queryAllByText } = await renderEdit('txn-9');

    // Nothing gates save on a read-only row (Save only appears once the
    // category changes, and only the category is writable), so no field shows
    // the required asterisk — hidden elements included, so a hidden marker would
    // still be caught.
    expect(queryAllByText('*', { includeHiddenElements: true })).toHaveLength(0);
  });

  // The counterparty->comment mapping writes a real
  // column no screen ever displayed — show it here, the SummaryTable "label
  // left, value right" detail-row pattern the deposit/bond breakdown and the
  // statement-import preview already use.
  it('shows no comment row when the synced transaction carries none', async () => {
    const { queryByText } = await renderEdit('txn-9');

    expect(queryByText('Comment')).toBeNull();
  });
});

describe('TransactionFormScreen — comment detail row', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the comment as a read-only detail row on a Monobank-synced transaction', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Imported latte',
      source: 'monobank',
      comment: 'ФОП Іванов',
    });

    const { getByText } = await renderEdit('txn-9');

    expect(getByText('Comment')).toBeTruthy();
    expect(getByText('ФОП Іванов')).toBeTruthy();
  });

  it('shows the comment as a read-only detail row on a manual transaction too', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      comment: 'Left at the counter',
    });

    const { getByText } = await renderEdit('txn-1');

    expect(getByText('Comment')).toBeTruthy();
    expect(getByText('Left at the counter')).toBeTruthy();
  });

  it('shows no comment row for a blank (whitespace-only) comment', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      comment: '   ',
    });

    const { queryByText } = await renderEdit('txn-1');

    expect(queryByText('Comment')).toBeNull();
  });

  // The comment row renders AFTER the description/category rows, not at
  // the very top of the form.
  it('DEFAULT: renders the comment row AFTER the Category field, not at the top of the form', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Imported latte',
      source: 'monobank',
      comment: 'ФОП Іванов',
    });

    const utils = await renderEdit('txn-9');
    const rendered = collectRenderedText(utils.toJSON());

    expect(rendered.indexOf('Category')).toBeGreaterThan(-1);
    expect(rendered.indexOf('Comment')).toBeGreaterThan(rendered.indexOf('Category'));
  });
});

describe('TransactionFormScreen — synced (binance) row', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A Binance-imported row: a real synced source that carries a BLANK
    // description and a null category. The blank description is why the
    // category-propagation sheet never opens for it (a name rule refuses a
    // blank catch-all), so the category must persist through the single-row,
    // ungated `setCategory` writer instead.
    setLiveData([{ id: 'h-btc', currency: 'BTC', balanceMinorUnits: 0, type: 'crypto_asset' }], {
      id: 'txn-b',
      holdingId: 'h-btc',
      amountMinorUnits: -50,
      time: 42,
      description: '',
      source: 'binance',
      category: null,
    });
  });

  it('persists the picked category on a blank-description binance row via setCategory', async () => {
    mockSetCategory.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-b');
    // A synced row shows no Save until its category actually changes.
    expect(utils.queryByText('Save')).toBeNull();

    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    // The single-row, ungated writer persists the category by id.
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-b',
        category: 'groceries',
      }),
    );
    // A blank description opens no propagation sheet, writes no name rule, and
    // never touches a bank-owned field.
    expect(utils.queryByText('Apply Category to All')).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('treats the bank-owned amount, description, date and time fields as read-only', async () => {
    const { getByLabelText } = await renderEdit('txn-b');

    expect(getByLabelText('Amount').props.editable).toBe(false);
    expect(getByLabelText('Description').props.editable).toBe(false);
    expect(getByLabelText('Date').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('Time').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the source-neutral read-only notice, never Monobank-specific wording', async () => {
    const { getByText, queryByText } = await renderEdit('txn-b');
    // A Binance row must not claim it came from Monobank.
    expect(getByText(/was synced/i)).toBeTruthy();
    expect(queryByText(/Monobank/i)).toBeNull();
  });

  it('still shows the editable category control on a read-only binance row', async () => {
    const { getByLabelText } = await renderEdit('txn-b');
    // The category picker stays offered even though the bank-owned fields lock.
    expect(getByLabelText('Category')).toBeTruthy();
  });
});

describe('TransactionFormScreen — category editing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates a MANUAL row category change through upsertCategoryOverride after confirming', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });
    mockUpsertCategoryOverride.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The themed confirm modal (not a native Alert) names the picked category
    // and the affected transaction name.
    expect(utils.getByText('Apply Category to All')).toBeTruthy();
    expect(utils.getByText(/Apply .Dining. to all transactions named .Coffee./)).toBeTruthy();

    await fireEvent.press(utils.getByText('Apply'));

    // The manual edit still runs, and the override propagates the category.
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'txn-1' }));
    await waitFor(() =>
      expect(mockUpsertCategoryOverride).toHaveBeenCalledWith('Coffee', 'dining'),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('persists a MANUAL blank-description row category via setCategory (the name rule skips it)', async () => {
    // A manual row with a BLANK description whose category the user changes.
    // The name-rule sheet refuses a blank catch-all, so before the fix the
    // pick was silently dropped on save. The single-row `setCategory` now
    // persists it by id, with no propagation sheet.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'cash' }], {
      id: 'txn-blank',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: '',
      source: 'manual',
      category: 'groceries',
    });
    mockSetCategory.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-blank');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    expect(utils.queryByText('Apply Category to All')).toBeNull();
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-blank',
        category: 'dining',
      }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('overrides ONLY this row via setCategory when "Just for this one" is pressed, never the name rule', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });
    mockSetCategory.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The sheet offers the single-row override alongside the all-similar one.
    await fireEvent.press(utils.getByText('Just for this one'));

    // Only the target row's category is rewritten, by id — the all-similar name
    // rule is never touched.
    await waitFor(() =>
      expect(mockSetCategory).toHaveBeenCalledWith({
        transactionId: 'txn-1',
        category: 'dining',
      }),
    );
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('sizes every confirm-sheet action the same as the primary Apply (full-width regular)', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // Every action in this confirm sheet matches the primary "Apply": the tall
    // regular 50pt size, full width. "Just for this one" and "Cancel" are NOT
    // shrunk to a compact/inline size here — they are full-width sheet actions.
    const apply = utils.getByRole('button', { name: 'Apply' });
    expect(StyleSheet.flatten(apply.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(apply.props.style).width).toBe('100%');

    const one = utils.getByRole('button', { name: 'Just for this one' });
    expect(StyleSheet.flatten(one.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(one.props.style).width).toBe('100%');

    const cancel = utils.getByRole('button', { name: 'Cancel' });
    expect(StyleSheet.flatten(cancel.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(cancel.props.style).width).toBe('100%');
  });

  it('does NOT offer "Just for this one" on a create flow (no transaction id to target)', async () => {
    // Create mode: the sheet still rises (a non-blank description + a category
    // pick), but there is no existing row to target — the just-created row
    // already carries its category from recordManual — so the single-row
    // override button must be absent.
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);

    const utils = await renderAdd();
    await fireEvent.changeText(utils.getByLabelText('Amount'), '12.34');
    await fireEvent.changeText(utils.getByLabelText('Description'), 'ATB');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));

    // The all-similar "Apply" is offered; the single-row override is not.
    expect(utils.getByText('Apply')).toBeTruthy();
    expect(utils.queryByText('Just for this one')).toBeNull();
    expect(mockSetCategory).not.toHaveBeenCalled();
  });

  it('propagates one override for a double-tapped Apply', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — see "records
    // one transaction for a double-tapped Save" above for why the two
    // presses are awaited sequentially instead of fired back to back.
    let resolveWrite: () => void = () => {};
    mockUpsertCategoryOverride.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    const apply = utils.getByText('Apply');

    await fireEvent.press(apply);
    await fireEvent.press(apply);

    expect(mockUpsertCategoryOverride).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(mockUpsertCategoryOverride).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);

    // jest.clearAllMocks() (this describe's beforeEach) clears call history
    // but not a custom mockImplementation — reset it explicitly so it does
    // not leak this test's never-auto-resolving write into the next test.
    mockUpsertCategoryOverride.mockReset();
  });

  // Both sheet writes can take a moment (Apply rewrites every same-name row):
  // the pressed action shows a spinner, and the sheet stays up — a scrim/back
  // dismiss or Cancel mid-write closes nothing — until the write is done.
  it.each([
    ['Apply', () => mockUpsertCategoryOverride],
    ['Just for this one', () => mockSetCategory],
  ])(
    'shows "%s" loading and keeps the sheet open until its write is done',
    async (actionLabel, writeMock) => {
      setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
        id: 'txn-1',
        holdingId: 'h1',
        amountMinorUnits: -1234,
        time: 42,
        description: 'Coffee',
        source: 'manual',
        category: 'groceries',
      });
      let resolveWrite: () => void = () => {};
      writeMock().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );

      const utils = await renderEdit('txn-1');
      await pickCategory(utils, 'Dining');
      await fireEvent.press(utils.getByText('Save'));

      const sheet = within(utils.getByTestId('category-override-sheet'));
      expect(sheet.queryByTestId('button-loading-spinner')).toBeNull();

      await fireEvent.press(sheet.getByText(actionLabel));

      expect(sheet.getAllByTestId('button-loading-spinner')).toHaveLength(1);

      await fireEvent(utils.getByTestId('category-override-sheet-modal'), 'requestClose');
      await fireEvent.press(sheet.getByText('Cancel'));

      expect(navigation.goBack).not.toHaveBeenCalled();

      await act(async () => {
        resolveWrite();
      });
      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));

      writeMock().mockReset();
    },
  );

  it('renders the picked category icon in white in the confirm modal', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));

    // The confirm sheet echoes the picked category's own glyph (mocked to a View
    // that forwards its props), rendered white (textPrimary) against the sheet —
    // not tinted its category color. Scoped to the sheet so the field's own icon
    // is not matched.
    const sheet = utils.getByTestId('category-override-sheet');
    const [icon] = sheet.queryAll((node) => node.props.name === 'fork.knife');
    expect(icon?.props.tintColor).toBe('#FFFFFF');
  });

  it('lets a SYNCED row save a category-only change via the override, without an update', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-9',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Monobank Merchant',
      source: 'monobank',
      category: 'groceries',
    });
    mockUpsertCategoryOverride.mockResolvedValue(undefined);

    const utils = await renderEdit('txn-9');
    // No Save until the category actually changes on a synced row.
    expect(utils.queryByText('Save')).toBeNull();

    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));
    await fireEvent.press(utils.getByText('Apply'));

    await waitFor(() =>
      expect(mockUpsertCategoryOverride).toHaveBeenCalledWith('Monobank Merchant', 'dining'),
    );
    // The bank-owned fields are never written on a synced row.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('never opens the confirm modal when the category is unchanged', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const { getByText, queryByText } = await renderEdit('txn-1');
    await fireEvent.press(getByText('Save'));

    expect(queryByText('Apply Category to All')).toBeNull();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not apply the override when the confirmation is cancelled', async () => {
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 5000, type: 'term_deposit' }], {
      id: 'txn-1',
      holdingId: 'h1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
      category: 'groceries',
    });

    const utils = await renderEdit('txn-1');
    await pickCategory(utils, 'Dining');
    await fireEvent.press(utils.getByText('Save'));
    await fireEvent.press(utils.getByText('Cancel'));

    // The manual edit from step 1 still stands, but no rule is written.
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpsertCategoryOverride).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('TransactionFormScreen — loan payment field', () => {
  const PAYER_HOLDING: Holding = {
    id: 'h1',
    currency: 'UAH',
    balanceMinorUnits: 5000,
    type: 'card',
  };
  const LOAN_HOLDING: Holding = {
    id: 'loan-1',
    currency: 'UAH',
    balanceMinorUnits: -100000,
    type: 'loan',
    name: 'Car loan',
    accountId: 'acc-debt',
  };
  const DEBT_ACCOUNT: Account = { id: 'acc-debt', name: 'Debts' };

  const debitTransaction: Transaction = {
    id: 'txn-1',
    holdingId: 'h1',
    amountMinorUnits: -1234,
    time: 42,
    description: 'Coffee',
    source: 'manual',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the field on an existing manual debit row when an open loan holding exists', async () => {
    setLiveData([PAYER_HOLDING, LOAN_HOLDING], debitTransaction, undefined, [DEBT_ACCOUNT]);

    const { getByLabelText } = await renderEdit('txn-1');

    expect(getByLabelText('Loan payment')).toBeTruthy();
  });

  it('shows the field on an existing SYNCED debit row too', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, source: 'monobank' },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { getByLabelText } = await renderEdit('txn-1');

    expect(getByLabelText('Loan payment')).toBeTruthy();
  });

  it('hides the field on an existing CREDIT (income) row', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, amountMinorUnits: 1234 },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { queryByLabelText } = await renderEdit('txn-1');

    expect(queryByLabelText('Loan payment')).toBeNull();
  });

  // A linked row later edited from debit to credit must not hide
  // the field where None/Undo live — `selectedLoanHoldingId` bypasses the
  // sign check entirely, the same "a filter never hides an active
  // selection" rule the field's own currency/closed-loan union already
  // follows.
  it('keeps the field visible on a linked row even after its own amount turns positive (credit)', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      {
        ...debitTransaction,
        amountMinorUnits: 1234,
        loanHoldingId: 'loan-1',
        loanLinkSource: 'manual',
      },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { getByLabelText, getByText } = await renderEdit('txn-1');

    expect(getByLabelText('Loan payment')).toBeTruthy();
    expect(getByText('Car loan')).toBeTruthy();
  });

  it('hides the field (data-driven) when no open loan holding exists', async () => {
    setLiveData([PAYER_HOLDING], debitTransaction, undefined, []);

    const { queryByLabelText } = await renderEdit('txn-1');

    expect(queryByLabelText('Loan payment')).toBeNull();
  });

  it('hides the field when the only loan holding is closed', async () => {
    setLiveData([PAYER_HOLDING, { ...LOAN_HOLDING, closedAt: 1 }], debitTransaction, undefined, [
      DEBT_ACCOUNT,
    ]);

    const { queryByLabelText } = await renderEdit('txn-1');

    expect(queryByLabelText('Loan payment')).toBeNull();
  });

  it('hides the field when the only loan holding is a different currency', async () => {
    setLiveData(
      [PAYER_HOLDING, { ...LOAN_HOLDING, currency: 'USD' }],
      debitTransaction,
      undefined,
      [DEBT_ACCOUNT],
    );

    const { queryByLabelText } = await renderEdit('txn-1');

    expect(queryByLabelText('Loan payment')).toBeNull();
  });

  it('keeps the field visible and lists the linked loan once it closes, with no other open loan', async () => {
    setLiveData(
      [PAYER_HOLDING, { ...LOAN_HOLDING, closedAt: 1 }],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'manual' },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { getByLabelText, getByText } = await renderEdit('txn-1');

    expect(getByLabelText('Loan payment')).toBeTruthy();
    expect(getByText('Car loan')).toBeTruthy();
  });

  it('keeps the field visible and lists the linked loan once it moves to another currency, with no other open loan', async () => {
    setLiveData(
      [PAYER_HOLDING, { ...LOAN_HOLDING, currency: 'USD' }],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'manual' },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { getByLabelText, getByText } = await renderEdit('txn-1');

    expect(getByLabelText('Loan payment')).toBeTruthy();
    expect(getByText('Car loan')).toBeTruthy();
  });

  // A loan lives under the implicit debt account, whose stored name is an
  // English sentinel until the user renames it: the picker row names it by its
  // display name.
  it('names the unrenamed implicit debt account in the loan picker by its localized default', async () => {
    setLiveData([PAYER_HOLDING, LOAN_HOLDING], debitTransaction, undefined, [
      { ...DEBT_ACCOUNT, name: 'Loans', kind: 'debt', archivedAt: null },
    ]);
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    try {
      const { getByLabelText, getByText } = await renderEdit('txn-1');

      await fireEvent.press(getByLabelText('Платіж за кредитом'));

      expect(getByLabelText('Car loan, Кредити')).toBeTruthy();
      expect(getByText('Кредити · UAH')).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });

  it('names a renamed implicit debt account in the loan picker by the name the user gave it', async () => {
    setLiveData([PAYER_HOLDING, LOAN_HOLDING], debitTransaction, undefined, [
      { ...DEBT_ACCOUNT, name: 'Bank debts', kind: 'debt', archivedAt: null },
    ]);

    const { getByLabelText, getByText, queryByText } = await renderEdit('txn-1');

    await fireEvent.press(getByLabelText('Loan payment'));

    expect(getByLabelText('Car loan, Bank debts')).toBeTruthy();
    expect(getByText('Bank debts · UAH')).toBeTruthy();
    expect(queryByText('Loans · UAH')).toBeNull();
  });

  it('persists a picked loan as a MANUAL link at once, with no Save press', async () => {
    setLiveData([PAYER_HOLDING, LOAN_HOLDING], debitTransaction, undefined, [DEBT_ACCOUNT]);
    mockSetLoanPayment.mockResolvedValue(undefined);

    const { getByLabelText, getByText } = await renderEdit('txn-1');

    await fireEvent.press(getByLabelText('Loan payment'));
    await fireEvent.press(getByText('Car loan'));

    expect(mockSetLoanPayment).toHaveBeenCalledWith({
      transactionId: 'txn-1',
      loanHoldingId: 'loan-1',
    });
  });

  it('picking "None" persists a cleared link at once', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'manual' },
      undefined,
      [DEBT_ACCOUNT],
    );
    mockSetLoanPayment.mockResolvedValue(undefined);

    const { getByLabelText, getAllByText } = await renderEdit('txn-1');

    await fireEvent.press(getByLabelText('Loan payment'));
    await fireEvent.press(getAllByText('None')[0]);

    expect(mockSetLoanPayment).toHaveBeenCalledWith({
      transactionId: 'txn-1',
      loanHoldingId: null,
    });
  });

  it('shows the auto-linked caption and Undo for an auto-sourced link', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'auto' },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { getByText } = await renderEdit('txn-1');

    expect(getByText('Linked automatically.')).toBeTruthy();
    expect(getByText('Undo')).toBeTruthy();
  });

  it('hides the auto-linked caption and Undo for a manual link', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'manual' },
      undefined,
      [DEBT_ACCOUNT],
    );

    const { queryByText } = await renderEdit('txn-1');

    expect(queryByText('Linked automatically.')).toBeNull();
    expect(queryByText('Undo')).toBeNull();
  });

  it('pressing Undo clears an auto-sourced link through undoAutoLoanLink', async () => {
    setLiveData(
      [PAYER_HOLDING, LOAN_HOLDING],
      { ...debitTransaction, loanHoldingId: 'loan-1', loanLinkSource: 'auto' },
      undefined,
      [DEBT_ACCOUNT],
    );
    mockUndoAutoLoanLink.mockResolvedValue(undefined);

    const { getByText } = await renderEdit('txn-1');

    await fireEvent.press(getByText('Undo'));

    expect(mockUndoAutoLoanLink).toHaveBeenCalledWith('txn-1');
  });
});

// Distinct holding types so the Exchange eligibility/destination-filter rules
// (cash-only source, non-source/non-closed/cash-only destination) can each be
// exercised against a fixture built for that exact case. A second cash holding
// (`cash-usd-1`) stands in for "an eligible destination" now that card is no
// longer create-eligible on either side.
const EXCHANGE_HOLDINGS: Holding[] = [
  { id: 'cash-1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Cash UAH' },
  { id: 'cash-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'cash', name: 'Cash USD' },
  { id: 'card-usd-1', currency: 'USD', balanceMinorUnits: 0, type: 'card', name: 'Card USD' },
  { id: 'bond-1', currency: 'UAH', balanceMinorUnits: 0, type: 'bond', name: 'Government Bond' },
  {
    id: 'old-cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Old Cash',
    closedAt: 1,
  },
  { id: 'war-bond-1', currency: 'UAH', balanceMinorUnits: 0, type: 'bond', name: 'War Bond' },
  { id: 'jar-1', currency: 'UAH', balanceMinorUnits: 0, type: 'jar', name: 'Monobank Jar' },
];

describe('TransactionFormScreen — Exchange mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(EXCHANGE_HOLDINGS);
  });

  it('offers Exchange only when the source holding is cash (not bond)', async () => {
    // Exchange is now a type-sheet option, not an inline chip: open the type
    // field before asserting whether the option is offered.
    const cash = await renderAddFromHolding('cash-1');
    await fireEvent.press(cash.getByLabelText('Type'));
    expect(cash.queryByText('Exchange')).toBeTruthy();

    const bond = await renderAddFromHolding('bond-1');
    await fireEvent.press(bond.getByLabelText('Type'));
    expect(bond.queryByText('Exchange')).toBeNull();
  });

  it('never offers Exchange in edit mode', async () => {
    setLiveData(EXCHANGE_HOLDINGS, {
      id: 'txn-1',
      holdingId: 'cash-1',
      amountMinorUnits: -1234,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });

    const utils = await renderEdit('txn-1');
    // Open the type sheet: an edit only offers income/expense, so Exchange must
    // not appear as an option there. Scoped to the option's own testID (not a
    // page-wide text query) because this row also offers the "Exchange" convert
    // action elsewhere on screen, which renders the identical word.
    await fireEvent.press(utils.getByLabelText('Type'));
    expect(utils.queryByTestId('transaction-type-field-option-exchange')).toBeNull();
  });

  it('caps the Exchange Date calendar at today', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2025, 2, 15, 14, 30, 0).getTime());
    const utils = await renderAddFromHolding('cash-1');

    await fireEvent.press(utils.getByLabelText('Type'));
    await fireEvent.press(utils.getByText('Exchange'));
    await flushDeferredModeSelect();
    await fireEvent.press(utils.getByLabelText('Date'));

    expect(utils.getByTestId('Date calendar').props.maxDate).toBe('2025-03-15');
    nowSpy.mockRestore();
  });

  it('lists open, non-source cash holdings in the destination select', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();
    await fireEvent.press(getByLabelText('To'));

    // Another cash holding is listed; the source itself, a closed cash
    // holding, a card, and bond/jar holdings are all excluded on create.
    expect(getByText('Cash USD')).toBeTruthy();
    expect(queryByText('Cash UAH')).toBeNull();
    expect(queryByText('Card USD')).toBeNull();
    expect(queryByText('Old Cash')).toBeNull();
    expect(queryByText('War Bond')).toBeNull();
    expect(queryByText('Monobank Jar')).toBeNull();
  });

  it('renders the type selector above the Exchange field group, not dropped below Date/Time', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await pickType(utils, 'exchange');

    const rendered = collectRenderedText(utils.toJSON());
    // The transaction-TYPE selector sits at the TOP of the form (directly under
    // the Holding select, absent here since the holding is fixed by navigation)
    // — ABOVE the entire Exchange field group (Value out, Value in, Date),
    // never dropped to the form bottom below Date/Time. Its 'Type' caption
    // stands in for the field's position.
    const order = ['Type', 'Value out', 'Value in', 'Date', 'Time'].map((label) =>
      rendered.indexOf(label),
    );

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('hides the category picker in Exchange mode', async () => {
    const { getByText, getByLabelText, queryByLabelText } = await renderAddFromHolding('cash-1');
    // Category field is visible in income/expense mode.
    expect(queryByLabelText('Category')).toBeTruthy();

    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();
    expect(queryByLabelText('Category')).toBeNull();
  });

  it.each([
    ['empty Value out', '', '2.50'],
    ['zero Value out', '0', '2.50'],
    ['negative Value out', '-10', '2.50'],
    ['empty Value in', '100', ''],
    ['zero Value in', '100', '0'],
    ['negative Value in', '100', '-5'],
  ])('rejects %s: recordExchange is not called', async (_case, valueOut, valueIn) => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));

    if (valueOut !== '') {
      await fireEvent.changeText(getByLabelText('Value out'), valueOut);
    }

    if (valueIn !== '') {
      await fireEvent.changeText(getByLabelText('Value in'), valueIn);
    }

    await fireEvent.press(getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();
  });

  it('keeps Save enabled through the Exchange steps but blocks the write until valid', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await pickType(utils, 'exchange');

    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;

    expect(isSaveDisabled()).toBe(false);
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();

    await fireEvent.changeText(utils.getByLabelText('Value out'), '100');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchange).not.toHaveBeenCalled();

    await fireEvent.changeText(utils.getByLabelText('Value in'), '2.5');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchange).toHaveBeenCalledTimes(1);
  });

  it('shows every Exchange field its own reason at the same Save press, only after Save is pressed', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await pickType(utils, 'exchange');

    expect(utils.queryByText('Select a destination account.')).toBeNull();
    await fireEvent.press(utils.getByText('Save'));

    // Destination, Value out, AND Value in are all still blank — every one
    // shows its own reason at this SAME press (Value out/Value in share the
    // identical "Amount must be greater than 0." copy, so two nodes carry it
    // at once).
    expect(utils.getByText('Select a destination account.')).toBeTruthy();
    expect(utils.getAllByText('Amount must be greater than 0.')).toHaveLength(2);
    expect(
      within(utils.getByTestId('screen-footer')).queryByText('Select a destination account.'),
    ).toBeNull();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    expect(utils.queryByText('Select a destination account.')).toBeNull();
    expect(utils.getAllByText('Amount must be greater than 0.')).toHaveLength(2);

    await fireEvent.changeText(utils.getByLabelText('Value out'), '100');
    expect(utils.getAllByText('Amount must be greater than 0.')).toHaveLength(1);

    await fireEvent.changeText(utils.getByLabelText('Value in'), '2.5');
    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
  });

  it('shows the received (Value in) leg the destination currency glyph as its suffix', async () => {
    const utils = await renderAddFromHolding('cash-1');
    await pickType(utils, 'exchange');

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));

    // Scope each glyph to its own field so neither passes by matching the
    // other leg's suffix: the sent (Value out) leg reads in the source currency
    // (UAH), the received (Value in) leg in the destination currency (USD).
    const suffixWithin = (label: string): ReturnType<typeof within> => {
      const field = utils.getByLabelText(label).parent;

      if (field === null) {
        throw new Error(`${label} field has no container`);
      }

      return within(field);
    };

    expect(suffixWithin('Value out').getByText('₴')).toBeTruthy();
    expect(suffixWithin('Value in').getByText('$')).toBeTruthy();
  });

  it('saves an exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();

    await fireEvent.changeText(getByLabelText('Value out'), '100');
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value in'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          valueOutMinorUnits: 10_000,
          destinationHoldingId: 'cash-usd-1',
          destinationType: 'cash',
          valueInMinorUnits: 250,
        }),
      ),
    );
  });
});

// Fixtures for the cash-only create rule plus account-name
// threading. `cash-1` and `cash-usd-1` sit under two
// different accounts so the destination's account name is unambiguous;
// `card-1`, `btc-1`, and `deposit-1` cover every non-cash type that create
// mode must now exclude on the destination side.
const EXCHANGE_CREATE_HOLDINGS: Holding[] = [
  {
    id: 'cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash UAH',
    accountId: 'acc-cash',
  },
  {
    id: 'cash-usd-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'btc-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'crypto_asset',
    name: 'BTC Wallet',
    accountId: 'acc-wallet',
  },
  {
    id: 'deposit-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'term_deposit',
    name: 'USD Deposit',
    accountId: 'acc-wallet',
  },
];

const EXCHANGE_CREATE_ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: 'Home' },
  { id: 'acc-wallet', name: 'Wallet' },
];

describe('TransactionFormScreen — Exchange create (cash-only, account names)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(EXCHANGE_CREATE_HOLDINGS, undefined, CATEGORIES, EXCHANGE_CREATE_ACCOUNTS);
  });

  it('offers Exchange from a cash source but NOT from a card source', async () => {
    // Exchange is a type-sheet option, so open the type field before asserting.
    const cash = await renderAddFromHolding('cash-1');
    await fireEvent.press(cash.getByLabelText('Type'));
    expect(cash.queryByText('Exchange')).toBeTruthy();

    const card = await renderAddFromHolding('card-1');
    await fireEvent.press(card.getByLabelText('Type'));
    expect(card.queryByText('Exchange')).toBeNull();
  });

  it('lists only cash destinations (card/crypto/term_deposit excluded) and shows account names', async () => {
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();
    await fireEvent.press(getByLabelText('To'));

    // Another cash holding is offered, with its account name shown (rendered
    // as "<account name> · <currency>", per holding-select-field.component).
    expect(getByText('Cash USD')).toBeTruthy();
    expect(getByText('Wallet · USD')).toBeTruthy(); // Cash USD's parent account name

    // The source itself and every non-cash type are excluded on create.
    expect(queryByText('Cash UAH')).toBeNull(); // the source itself
    expect(queryByText('Card USD')).toBeNull(); // card excluded on create
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto excluded on create
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit excluded on create
  });

  it('saves a cash->cash exchange with correct minor units and holding ids', async () => {
    const { getByText, getByLabelText } = await renderAddFromHolding('cash-1');
    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();

    await fireEvent.changeText(getByLabelText('Value out'), '100');
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value in'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceHoldingId: 'cash-1',
          valueOutMinorUnits: 10_000, // 100 UAH -> minor (scale 2)
          destinationHoldingId: 'cash-usd-1',
          destinationType: 'cash',
          valueInMinorUnits: 250, // 2.50 USD -> minor (scale 2)
        }),
      ),
    );
  });
});

// Fixtures for the picker-order rule: two accounts whose display order
// (the sortOrder-driven `accountsRepo.listQuery` order) is Bravo before Alpha,
// each holding one eligible cash destination. The raw `holdings.allQuery`
// array below is deliberately NOT grouped by account, so a picker that
// preserves that order would list Alpha's holding first. The Accounts screen
// groups holdings under their account, so the picker must too.
const PICKER_ORDER_HOLDINGS: Holding[] = [
  {
    id: 'src',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Source',
    accountId: 'acc-alpha',
    sortOrder: 0,
    createdAt: 1,
  },
  {
    id: 'dest-alpha',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Dest Alpha',
    accountId: 'acc-alpha',
    sortOrder: 1,
    createdAt: 2,
  },
  {
    id: 'dest-bravo',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Dest Bravo',
    accountId: 'acc-bravo',
    sortOrder: 0,
    createdAt: 3,
  },
];

// listQuery order (account sortOrder): Bravo ranks before Alpha.
const PICKER_ORDER_ACCOUNTS: Account[] = [
  { id: 'acc-bravo', name: 'Bravo' },
  { id: 'acc-alpha', name: 'Alpha' },
];

describe('TransactionFormScreen — From/To picker order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(PICKER_ORDER_HOLDINGS, undefined, CATEGORIES, PICKER_ORDER_ACCOUNTS);
  });

  it('orders the destination picker by the Accounts screen order (account, then holding)', async () => {
    const utils = await renderAddFromHolding('src');
    await pickType(utils, 'exchange');
    await fireEvent.press(utils.getByLabelText('To'));

    const rendered = collectRenderedText(utils.toJSON());
    const bravoIndex = rendered.indexOf('Dest Bravo');
    const alphaIndex = rendered.indexOf('Dest Alpha');

    expect(bravoIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeGreaterThan(-1);
    // Bravo's account ranks first, so its holding lists before Alpha's.
    expect(bravoIndex).toBeLessThan(alphaIndex);
  });
});

// Fixtures for convert-mode: `cash-1` is the existing row's own
// holding for the expense/income-manual cases; `card-1` stands in for a
// SYNCED row's holding. `cash-usd-1` and `card-eur-1` are eligible
// counterparts under the WIDER convert predicates (cash/card, unlike the
// cash-only create rule); `deposit-1` (term_deposit) and `btc-1`
// (crypto_asset) must never appear as a source, and `deposit-1`'s holding
// type also makes its OWN transaction row ineligible for the action at all.
const CONVERT_HOLDINGS: Holding[] = [
  {
    id: 'cash-1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash UAH',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'cash-usd-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash USD',
    accountId: 'acc-wallet',
  },
  {
    id: 'card-eur-1',
    currency: 'EUR',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card EUR',
    accountId: 'acc-wallet',
  },
  {
    id: 'deposit-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'term_deposit',
    name: 'USD Deposit',
    accountId: 'acc-wallet',
  },
  {
    id: 'btc-1',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'crypto_asset',
    name: 'BTC Wallet',
    accountId: 'acc-wallet',
  },
];

const CONVERT_ACCOUNTS: Account[] = [{ id: 'acc-wallet', name: 'Wallet' }];

// A synced, same-currency, open holding eligible under convert-mode's WIDER
// destination/source rules (card qualifies both ways) — its account is
// connected to a sync AND it carries that source's metadata key, so
// `isSyncedHolding` is true and the convert counterpart picker must exclude
// it — a sync owns that holding's balance, so Save could otherwise
// write a manual leg onto it.
const CONVERT_SYNCED_HOLDING: Holding = {
  id: 'synced-card-1',
  currency: 'USD',
  balanceMinorUnits: 0,
  type: 'card',
  name: 'Synced Card',
  accountId: 'sync-acc',
  metadata: { monobankId: 'mono-9' },
};

const CONVERT_SYNCED_ACCOUNT: Account = {
  id: 'sync-acc',
  name: 'Monobank',
  institution: 'monobank',
};

const CONVERT_TRANSACTIONS: Record<string, Transaction> = {
  'expense-manual': {
    id: 'expense-manual',
    holdingId: 'cash-1',
    amountMinorUnits: -10_000,
    time: 42,
    description: 'Groceries',
    source: 'manual',
  },
  'expense-synced': {
    id: 'expense-synced',
    holdingId: 'card-1',
    amountMinorUnits: -5_000,
    time: 42,
    description: 'Imported purchase',
    source: 'monobank',
  },
  'income-manual': {
    id: 'income-manual',
    holdingId: 'cash-1',
    amountMinorUnits: 8_000,
    time: 42,
    description: 'Refund',
    source: 'manual',
  },
  'zero-amount': {
    id: 'zero-amount',
    holdingId: 'cash-1',
    amountMinorUnits: 0,
    time: 42,
    description: 'Zero',
    source: 'manual',
  },
  'deposit-txn': {
    id: 'deposit-txn',
    holdingId: 'deposit-1',
    amountMinorUnits: -1_000,
    time: 42,
    description: 'Deposit',
    source: 'manual',
  },
};

describe('TransactionFormScreen — Convert to Exchange', () => {
  const renderEdit = (transactionId: string): ReturnType<typeof render> => {
    setLiveData(
      CONVERT_HOLDINGS,
      CONVERT_TRANSACTIONS[transactionId],
      CATEGORIES,
      CONVERT_ACCOUNTS,
    );
    const route = transactionFormRoute({ transactionId });

    return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the action for a non-zero expense on a cash/card holding (manual AND synced)', async () => {
    const manual = await renderEdit('expense-manual');
    expect(manual.queryByText('Exchange')).toBeTruthy();

    const synced = await renderEdit('expense-synced');
    expect(synced.queryByText('Exchange')).toBeTruthy();
  });

  it('renders the Exchange action at the small inline size', async () => {
    const { getByRole } = await renderEdit('expense-manual');

    // The action is a small inline secondary of the form's Save CTA, so it takes
    // the shorter `small` size (34pt visible, 44pt tap via hitSlop) rather than
    // the taller 44pt `compact` — matching the other small inline actions.
    const convert = getByRole('button', { name: 'Exchange' });
    expect(StyleSheet.flatten(convert.props.style).minHeight).toBe(34);
  });

  it('caps the convert Date calendar at today', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(2025, 2, 15, 14, 30, 0).getTime());
    const { getByText, getByLabelText, getByTestId } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('Date'));

    expect(getByTestId('Date calendar').props.maxDate).toBe('2025-03-15');
    nowSpy.mockRestore();
  });

  it('does NOT show the action for a zero amount or a non-liquid holding', async () => {
    const zero = await renderEdit('zero-amount');
    expect(zero.queryByText('Exchange')).toBeNull();

    const deposit = await renderEdit('deposit-txn');
    expect(deposit.queryByText('Exchange')).toBeNull();
  });

  it('opens the destination ("To") form for an expense-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Exchange'));

    // Expense source: the fixed side is Value out; the picked leg is a destination ("To").
    expect(getByText('Value out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value in')).toBeTruthy();
  });

  it('opens the source ("From") form for an income-sourced convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('income-manual');

    await fireEvent.press(getByText('Exchange'));

    // Income destination: the fixed side is Value in; the picked leg is a source ("From").
    expect(getByText('Value in')).toBeTruthy();
    expect(getByLabelText('From')).toBeTruthy();
    expect(getByLabelText('Value out')).toBeTruthy();
  });

  it('writes the destination leg with the right sign, id, and exchange marker for an expense convert', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');
    // existing: holding 'cash-1' name 'Cash UAH', amount -10_000 (100.00 UAH)

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD')); // a cash destination in another account
    await fireEvent.changeText(getByLabelText('Value in'), '2.50');

    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(mockRecordExchangeCounterpart).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'record-destination',
          counterpartHoldingId: 'cash-usd-1',
          counterpartType: 'cash',
          amountMinorUnits: 250, // 2.50 USD -> minor
          // The EXISTING row's own id and holding id: the row is marked as the
          // other leg of this movement, and its holding becomes the new leg's
          // structural exchange marker (no English description is persisted).
          existingTransactionId: 'expense-manual',
          existingHoldingId: 'cash-1',
        }),
      ),
    );
  });

  it('restricts the source picker to cash/card for an income convert', async () => {
    const { getByText, getByLabelText, queryByText } = await renderEdit('income-manual');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('From'));

    expect(getByText('Cash USD')).toBeTruthy(); // cash offered
    expect(getByText('Card EUR')).toBeTruthy(); // card offered
    expect(queryByText('USD Deposit')).toBeNull(); // term_deposit NOT a source
    expect(queryByText('BTC Wallet')).toBeNull(); // crypto NOT a source
  });

  it('excludes a synced/syncable holding from the convert counterpart picker', async () => {
    setLiveData(
      [...CONVERT_HOLDINGS, CONVERT_SYNCED_HOLDING],
      CONVERT_TRANSACTIONS['expense-manual'],
      CATEGORIES,
      [...CONVERT_ACCOUNTS, CONVERT_SYNCED_ACCOUNT],
    );

    const { getByText, getByLabelText, queryByText } = await render(
      <TransactionFormScreen
        route={transactionFormRoute({ transactionId: 'expense-manual' })}
        navigation={navigationProp}
      />,
    );

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));

    // A same-currency, open, manual counterpart still qualifies...
    expect(getByText('Cash USD')).toBeTruthy();
    // ...but a synced/syncable holding never appears (its balance is sync-owned).
    expect(queryByText('Synced Card')).toBeNull();
  });

  it('rejects a blank/zero/negative counterpart amount (no write)', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    // Part A: picking a destination now PREFILLS an approximate value through
    // the bundled fiat rate seed (`buildRateTable`'s fallback layer, proven in
    // the "convert counterpart prefill" describe block below) — explicitly
    // blank the field to exercise the validation guard this test targets.
    await fireEvent.changeText(getByLabelText('Value in'), '');
    await fireEvent.press(getByText('Save'));

    expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();
  });

  it('keeps Save enabled through the Convert steps but blocks the write until valid', async () => {
    const utils = await renderEdit('expense-manual');
    await fireEvent.press(utils.getByText('Exchange'));

    const isSaveDisabled = (): boolean | undefined =>
      utils.getByText('Save').parent?.props.accessibilityState.disabled;

    expect(isSaveDisabled()).toBe(false);
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    // Part A: picking a destination now PREFILLS an approximate value through
    // the bundled fiat rate seed — blank it explicitly so this still exercises
    // the "blocked until valid" guard (see the note on the test above).
    await fireEvent.changeText(utils.getByLabelText('Value in'), '');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchangeCounterpart).not.toHaveBeenCalled();

    await fireEvent.changeText(utils.getByLabelText('Value in'), '2.5');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordExchangeCounterpart).toHaveBeenCalledTimes(1);
  });

  it('shows an inline reason through the Convert steps, only after Save is pressed', async () => {
    const utils = await renderEdit('expense-manual');
    await fireEvent.press(utils.getByText('Exchange'));

    expect(utils.queryByText('Select an account to convert into.')).toBeNull();
    await fireEvent.press(utils.getByText('Save'));
    expect(utils.getByText('Select an account to convert into.')).toBeTruthy();
    expect(
      within(utils.getByTestId('screen-footer')).queryByText('Select an account to convert into.'),
    ).toBeNull();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));
    // Part A: picking a destination now PREFILLS an approximate value through
    // the bundled fiat rate seed — blank it explicitly to still reach the
    // "amount must be greater than 0" reason this test targets.
    await fireEvent.changeText(utils.getByLabelText('Value in'), '');
    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(
      within(utils.getByTestId('screen-footer')).queryByText('Amount must be greater than 0.'),
    ).toBeNull();

    await fireEvent.changeText(utils.getByLabelText('Value in'), '2.5');
    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
  });

  it('shows the destination and amount errors together at the same Save press, each clearing only its own field', async () => {
    const utils = await renderEdit('expense-manual');
    await fireEvent.press(utils.getByText('Exchange'));

    await fireEvent.press(utils.getByText('Save'));

    expect(utils.getByText('Select an account to convert into.')).toBeTruthy();
    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();

    await fireEvent.changeText(utils.getByLabelText('Value in'), '2.5');

    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
    expect(utils.getByText('Select an account to convert into.')).toBeTruthy();

    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash USD'));

    expect(utils.queryByText('Select an account to convert into.')).toBeNull();
  });

  it('never calls update/remove on the existing row when converting', async () => {
    const { getByText, getByLabelText } = await renderEdit('expense-synced');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Cash USD'));
    await fireEvent.changeText(getByLabelText('Value in'), '5');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(mockRecordExchangeCounterpart).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// Fixtures for Split-change mode: `payer` is the paying cash holding;
// `friend-a`/`friend-b` are two OTHER open UAH holdings the change can return
// to; `usd-cash` is a same-liquidity holding in a DIFFERENT currency, which the
// v1 return picker must exclude (returns are payer-currency only).
const SPLIT_HOLDINGS: Holding[] = [
  {
    id: 'payer',
    currency: 'UAH',
    balanceMinorUnits: 50_000,
    type: 'cash',
    name: 'Wallet UAH',
    accountId: 'acc',
  },
  {
    id: 'friend-a',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Alice',
    accountId: 'acc',
  },
  {
    id: 'friend-b',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Bob',
    accountId: 'acc',
  },
  {
    id: 'usd-cash',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'USD Cash',
    accountId: 'acc',
  },
];

const SPLIT_ACCOUNTS: Account[] = [{ id: 'acc', name: 'Home' }];

// A synced, same-currency, open holding: its account is connected to a sync
// (Binance) AND it carries that source's metadata key, so `isSyncedHolding` is
// true and the return picker must exclude it (item 6), even though currency and
// open-status would otherwise qualify it.
const SPLIT_SYNCED_HOLDING: Holding = {
  id: 'synced-uah',
  currency: 'UAH',
  balanceMinorUnits: 0,
  type: 'cash',
  name: 'Synced Wallet',
  accountId: 'sync-acc',
  metadata: { binanceAsset: 'BTC' },
};

const SPLIT_SYNCED_ACCOUNT: Account = { id: 'sync-acc', name: 'Binance', institution: 'binance' };

// A row of the removed `share` type can still arrive through an old development
// export or sit on a device that ran a development build; the form must still
// render with it listed, and never offer it as an Exchange leg.
const REMOVED_TYPE_HOLDING: Holding = {
  id: 'share-1',
  currency: 'USD',
  balanceMinorUnits: 500,
  type: 'share',
  name: 'Apple stock',
  accountId: 'acc-wallet',
};

describe('TransactionFormScreen — a stored holding of a removed type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the create form and offers the row as no Exchange destination', async () => {
    setLiveData(
      [...EXCHANGE_CREATE_HOLDINGS, REMOVED_TYPE_HOLDING],
      undefined,
      CATEGORIES,
      EXCHANGE_CREATE_ACCOUNTS,
    );
    const { getByText, getByLabelText, queryByText } = await renderAddFromHolding('cash-1');

    await fireEvent.press(getByLabelText('Type'));
    await fireEvent.press(getByText('Exchange'));
    await flushDeferredModeSelect();
    await fireEvent.press(getByLabelText('To'));

    expect(getByText('Cash USD')).toBeTruthy();
    expect(queryByText('Apple stock')).toBeNull();
  });

  it('renders the create form opened from the removed-type row, with no Exchange mode', async () => {
    setLiveData(
      [...EXCHANGE_CREATE_HOLDINGS, REMOVED_TYPE_HOLDING],
      undefined,
      CATEGORIES,
      EXCHANGE_CREATE_ACCOUNTS,
    );
    const { getByLabelText, queryByText } = await renderAddFromHolding('share-1');

    await fireEvent.press(getByLabelText('Type'));

    expect(queryByText('Exchange')).toBeNull();
  });

  it('offers the row as no convert destination for an expense', async () => {
    setLiveData(
      [...CONVERT_HOLDINGS, REMOVED_TYPE_HOLDING],
      CONVERT_TRANSACTIONS['expense-manual'],
      CATEGORIES,
      CONVERT_ACCOUNTS,
    );
    const { getByText, getByLabelText, queryByText } = await renderEdit('expense-manual');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('To'));

    expect(getByText('Cash USD')).toBeTruthy();
    expect(queryByText('Apple stock')).toBeNull();
  });

  it('offers the row as no convert source for an income', async () => {
    setLiveData(
      [...CONVERT_HOLDINGS, REMOVED_TYPE_HOLDING],
      CONVERT_TRANSACTIONS['income-manual'],
      CATEGORIES,
      CONVERT_ACCOUNTS,
    );
    const { getByText, getByLabelText, queryByText } = await renderEdit('income-manual');

    await fireEvent.press(getByText('Exchange'));
    await fireEvent.press(getByLabelText('From'));

    expect(getByText('Cash USD')).toBeTruthy();
    expect(queryByText('Apple stock')).toBeNull();
  });

  it('shows no convert action on a transaction of the removed-type row itself', async () => {
    setLiveData(
      [...CONVERT_HOLDINGS, REMOVED_TYPE_HOLDING],
      {
        id: 'share-txn',
        holdingId: 'share-1',
        amountMinorUnits: -1_000,
        time: 42,
        description: 'Fee',
        source: 'manual',
      },
      CATEGORIES,
      CONVERT_ACCOUNTS,
    );
    const { getByLabelText, queryByText } = await renderEdit('share-txn');

    expect(getByLabelText('Type')).toBeTruthy();
    expect(queryByText('Exchange')).toBeNull();
  });
});

describe('TransactionFormScreen — Split-change mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData(SPLIT_HOLDINGS, undefined, CATEGORIES, SPLIT_ACCOUNTS);
  });

  it('records a split payment with two linked returns via recordManualWithReturns', async () => {
    mockRecordManualWithReturns.mockResolvedValue(undefined);

    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    // One return row exists by default; add a second.
    await fireEvent.press(utils.getByText('Add return'));

    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.press(utils.getByLabelText('Return to 2'));
    await fireEvent.press(utils.getByText('Bob'));

    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
    await fireEvent.changeText(utils.getByLabelText('Return 2'), '0.08');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '212.00');
    await pickCategory(utils, 'Groceries');

    await fireEvent.press(utils.getByText('Save'));

    await waitFor(() => expect(mockRecordManualWithReturns).toHaveBeenCalledTimes(1));
    expect(mockRecordManualWithReturns).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({
          holdingId: 'payer',
          amountMinorUnits: -212_00,
          category: 'groceries',
        }),
        returns: [
          { holdingId: 'friend-a', amountMinorUnits: 20 },
          { holdingId: 'friend-b', amountMinorUnits: 8 },
        ],
      }),
    );
  });

  it('does not write while the returns sum to at least the payment, and Save stays enabled', async () => {
    const utils = await renderAddFromHolding('payer');

    await pickType(utils, 'split');
    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
    await pickCategory(utils, 'Groceries');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '0.20');

    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordManualWithReturns).not.toHaveBeenCalled();

    await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordManualWithReturns).toHaveBeenCalledTimes(1);
  });

  it('shows an inline reason for an incomplete split, only after Save is pressed', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    expect(utils.queryByText('Select a category.')).toBeNull();
    await fireEvent.press(utils.getByText('Save'));
    expect(utils.getByText('Select a category.')).toBeTruthy();
    expect(within(utils.getByTestId('screen-footer')).queryByText('Select a category.')).toBeNull();

    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));
    expect(
      utils.getByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeTruthy();
    expect(
      within(utils.getByTestId('screen-footer')).queryByText(
        'Add at least one valid return, and keep the returns below the payment.',
      ),
    ).toBeNull();
  });

  it('shows the category and split-returns errors together at the same Save press, each clearing only its own field', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    await fireEvent.press(utils.getByText('Save'));

    expect(utils.getByText('Select a category.')).toBeTruthy();
    expect(
      utils.getByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeTruthy();

    await pickCategory(utils, 'Groceries');

    expect(utils.queryByText('Select a category.')).toBeNull();
    expect(
      utils.getByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeTruthy();

    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');

    expect(
      utils.queryByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeNull();
  });

  // The split error renders under the return rows and judges every one of
  // them, so every return row's labels turn red with it.
  it('turns every return row label red with the split-returns error, and back once valid', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await pickCategory(utils, 'Groceries');

    expect(isLabelInvalid(mockFieldLabel, 'Return to 1')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(false);

    await fireEvent.press(utils.getByText('Save'));

    expect(isLabelInvalid(mockFieldLabel, 'Return to 1')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(true);

    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');

    expect(isLabelInvalid(mockFieldLabel, 'Return to 1')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(false);
  });

  it('gives an empty payment its own Amount error, leaving valid returns grey', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');

    await fireEvent.press(utils.getByText('Save'));

    expect(mockRecordManualWithReturns).not.toHaveBeenCalled();
    expect(utils.getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(isLabelInvalid(mockFieldLabel, 'Amount')).toBe(true);
    expect(
      utils.queryByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeNull();
    expect(isLabelInvalid(mockFieldLabel, 'Return to 1')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(false);
  });

  // The returns error then judges the payment too, so the Amount label turns
  // red with the return rows, under the one returns message.
  it('turns the Amount and return labels red while the returns total the payment or more', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '1.50');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');

    await fireEvent.press(utils.getByText('Save'));

    expect(mockRecordManualWithReturns).not.toHaveBeenCalled();
    expect(
      utils.getByText('Add at least one valid return, and keep the returns below the payment.'),
    ).toBeTruthy();
    expect(utils.queryByText('Amount must be greater than 0.')).toBeNull();
    expect(isLabelInvalid(mockFieldLabel, 'Amount')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Return to 1')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(true);

    await fireEvent.changeText(utils.getByLabelText('Amount'), '2.00');

    expect(isLabelInvalid(mockFieldLabel, 'Amount')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Return 1')).toBe(false);
  });

  it('does not write an otherwise-valid split until a category is picked', async () => {
    const utils = await renderAddFromHolding('payer');

    await pickType(utils, 'split');
    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));
    await fireEvent.changeText(utils.getByLabelText('Return 1'), '0.20');
    await fireEvent.changeText(utils.getByLabelText('Amount'), '1.00');

    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordManualWithReturns).not.toHaveBeenCalled();

    await pickCategory(utils, 'Groceries');
    await fireEvent.press(utils.getByText('Save'));
    expect(mockRecordManualWithReturns).toHaveBeenCalledTimes(1);
  });

  it('excludes a holding already picked in another row (and any off-currency holding) from the next picker', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByText('Add return'));

    await fireEvent.press(utils.getByLabelText('Return to 1'));
    await fireEvent.press(utils.getByText('Alice'));

    // Open row 2's picker: Alice is gone (picked in row 1), Bob remains, and the
    // USD holding never appears (returns are payer-currency only in v1).
    await fireEvent.press(utils.getByLabelText('Return to 2'));
    expect(utils.getByText('Bob')).toBeTruthy();
    expect(utils.queryByText('USD Cash')).toBeNull();
    // Alice shows exactly once — as row 1's selected trigger value, never as a
    // row-2 option — so no two rows can target the same holding.
    expect(utils.getAllByText('Alice')).toHaveLength(1);
  });

  it('previews an EXPENSE-style description placeholder in split mode (item 1)', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    // A split is an expense, so its blank-description preview must read as the
    // expense fallback ("<holding> expense"), never the income one.
    const description = utils.getByLabelText('Description');
    expect(description.props.placeholder).toBe('Wallet UAH expense');
    expect(description.props.placeholder).not.toBe('Wallet UAH income');
  });

  it('allows the payer holding itself as a return target (item 2)', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByLabelText('Return to 1'));

    // The payer ("Wallet UAH") is now offered as a valid return target.
    expect(utils.getByText('Wallet UAH')).toBeTruthy();
  });

  it('excludes a synced/syncable holding from the return picker (item 6)', async () => {
    setLiveData([...SPLIT_HOLDINGS, SPLIT_SYNCED_HOLDING], undefined, CATEGORIES, [
      ...SPLIT_ACCOUNTS,
      SPLIT_SYNCED_ACCOUNT,
    ]);

    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByLabelText('Return to 1'));

    // A same-currency, open, non-payer holding still qualifies...
    expect(utils.getByText('Alice')).toBeTruthy();
    // ...but a synced/syncable holding never appears (its balance is sync-owned).
    expect(utils.queryByText('Synced Wallet')).toBeNull();
  });

  // A ledgerless holding is valued from its metadata, so a return row on it
  // would vanish from net worth: the picker never offers one, whatever its
  // account and currency.
  it('never offers a ledgerless holding type in the return picker', async () => {
    const ledgerlessTypes = holdingTypes.filter((type) => isLedgerlessHoldingType(type));

    setLiveData(
      [
        ...SPLIT_HOLDINGS,
        ...ledgerlessTypes.map(
          (type): Holding => ({
            id: `ledgerless-${type}`,
            currency: 'UAH',
            balanceMinorUnits: 0,
            type,
            name: `Ledgerless ${type}`,
            accountId: 'acc',
          }),
        ),
      ],
      undefined,
      CATEGORIES,
      SPLIT_ACCOUNTS,
    );

    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByLabelText('Return to 1'));

    expect(utils.getByText('Alice')).toBeTruthy();
    expect(utils.getByText('Bob')).toBeTruthy();
    // An empty list would make the loop below vacuous.
    expect(ledgerlessTypes.length).toBeGreaterThan(0);

    for (const type of ledgerlessTypes) {
      expect(utils.queryByText(`Ledgerless ${type}`)).toBeNull();
    }
  });

  it('renders the return-row delete control with a text label and removes the row (item 3)', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByText('Add return'));

    // The delete control now carries the shared button's TEXT label (not the old
    // icon-only button): one per row.
    expect(utils.getAllByText('Remove').length).toBeGreaterThanOrEqual(2);

    // Pressing the second row's delete removes that row.
    await fireEvent.press(utils.getByLabelText('Remove return 2'));
    expect(utils.queryByLabelText('Return to 2')).toBeNull();
  });

  it('hides the return-row delete control while exactly one return exists', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    // Split mode seeds exactly one return row and no others were added, so the
    // last remaining return must not offer a delete control — mirrors the
    // deposit contributions list's own single-row guard.
    expect(utils.queryByLabelText('Remove return 1')).toBeNull();
    expect(utils.queryByText('Remove')).toBeNull();
  });

  it('shows a delete control on every row once a second return is added', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    await fireEvent.press(utils.getByText('Add return'));

    // With two or more rows, each one gets its own delete control.
    expect(utils.getByLabelText('Remove return 1')).toBeTruthy();
    expect(utils.getByLabelText('Remove return 2')).toBeTruthy();
    expect(utils.getAllByText('Remove')).toHaveLength(2);
  });

  // Every scroll-on-add-row trigger, not only "Додати внесок" (add
  // contribution), must route through
  // the SAME occlusion-aware `scrollToField` helper the Save-invalid path
  // already uses — never an unconditional `scrollToEnd`, which would scroll
  // even when the newly added row was already fully visible.
  it('scrolls to the newly added return through the occlusion-aware scrollToField helper, not an unconditional scrollToEnd', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    // The scroll is deferred to the next frame so the just-added row is
    // measured first; run that frame synchronously to assert the effect (same
    // pattern as the categories screen's own deferred scroll-to-form test).
    const rafSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);

        return 0;
      });

    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    scrollToFieldMock.mockClear();
    await fireEvent.press(utils.getByText('Add return'));

    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    const [, , geometry] = scrollToFieldMock.mock.calls[0];
    expect(geometry).toEqual(
      expect.objectContaining({
        currentOffset: expect.any(Number),
        contentHeight: expect.any(Number),
      }),
    );

    rafSpy.mockRestore();
  });

  it('targets the newly appended return row (not a fixed one) on each Add return press', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const rafSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);

        return 0;
      });

    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');
    scrollToFieldMock.mockClear();
    await fireEvent.press(utils.getByText('Add return'));
    // The SAME `lastReturnFieldRef` object is passed on every call — a ref
    // container never changes identity — so the newest-row proof reads its
    // mutable `.current` at each point in time, not the ref object itself.
    const [, rowRef] = scrollToFieldMock.mock.calls[0];
    const secondRowNode = rowRef.current;

    scrollToFieldMock.mockClear();
    await fireEvent.press(utils.getByText('Add return'));
    const thirdRowNode = rowRef.current;

    expect(thirdRowNode).not.toBeNull();
    expect(thirdRowNode).not.toBe(secondRowNode);

    rafSpy.mockRestore();
  });

  it('renders a divider and a section heading above the returns list (item 4)', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    expect(utils.getByTestId('returns-divider')).toBeTruthy();
    expect(utils.getByText('Change Returns')).toBeTruthy();

    // The heading precedes the first return row in reading order.
    const rendered = collectRenderedText(utils.toJSON());
    expect(rendered.indexOf('Change Returns')).toBeLessThan(rendered.indexOf('Return to 1'));
  });

  it('switches from Split to another type without throwing (crash regression)', async () => {
    // The reported crash's actual root cause: the transaction-type select
    // trigger renders ONE persistent `<SymbolIcon>` whose `fallbackName` prop
    // toggled from a string to `undefined` on leaving Split: an UPDATE, not a
    // fresh mount, which Fabric serializes as native `null`, and the native
    // SFSymbolView binding throws on `null`. Jest cannot reproduce that native
    // host-function throw itself (symbol.component.test.tsx pins that the prop
    // stays a string across a rename), so this asserts the RTL-level contract
    // instead: the flow completes without throwing, the split-only UI
    // unmounts, and the new mode is applied.
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    expect(utils.getByTestId('returns-divider')).toBeTruthy();

    await pickType(utils, 'expense');

    expect(utils.queryByTestId('returns-divider')).toBeNull();
    expect(utils.getByTestId('transaction-type-field')).toHaveTextContent('Expense');
  });

  it('shows the split-returns wrapper (no display: none) once split mode is selected', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    const wrapperStyle = StyleSheet.flatten(utils.getByTestId('split-returns-wrapper').props.style);
    expect(wrapperStyle?.display).toBeUndefined();
  });

  // Wrapping `renderSplitReturns`'s Fragment in this `View` (wrapping the
  // divider/heading/rows/button in one `View`) pulls them OUT of the parent
  // `Box gap={4}`'s own flex-item list — they used to be its direct children,
  // each getting that 16pt rhythm; now they are all ONE child, with nothing
  // supplying a gap between them. The wrapper must carry the SAME gap itself.
  it('gives the split-returns wrapper its own gap matching the form rhythm, once split mode is selected', async () => {
    const utils = await renderAddFromHolding('payer');
    await pickType(utils, 'split');

    const wrapperStyle = StyleSheet.flatten(utils.getByTestId('split-returns-wrapper').props.style);
    expect(wrapperStyle.gap).toBe(darkTheme.spacing(4));
  });
});

describe('TransactionFormScreen — phantom gap regression (split-returns wrapper)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData([{ id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash' }]);
  });

  // The split-returns wrapper `View` always mounts (see the CALL SITE comment
  // in transaction-form.screen.tsx), but `renderSplitReturns` renders `null`
  // in every non-split mode. An empty rendered child still counts as a flex
  // item in the parent `Box`'s `gap` layout, doubling the gap on both sides of
  // it (32pt between Time and Category instead of 16pt) — `display: 'none'`
  // is the fix, asserted here directly rather than only via `queryByTestId`.
  it('hides the split-returns wrapper with display: none in the default (non-split) mode, so it claims no phantom gap slot', async () => {
    const utils = await renderAdd();

    // `getByTestId` excludes elements hidden from accessibility by default
    // (RNTL v12+) — exactly what this test is proving is applied, so it must
    // opt back in with `hidden: true` to find the element at all.
    const wrapperStyle = StyleSheet.flatten(
      utils.getByTestId('split-returns-wrapper', { hidden: true }).props.style,
    );
    expect(wrapperStyle.display).toBe('none');
  });
});

describe('canSaveSplit', () => {
  it('enforces a positive payment, ≥1 distinct return (payer allowed), and Σ returns < payment', () => {
    // A valid split: two distinct non-payer returns summing below the payment.
    expect(
      canSaveSplit(
        '212.00',
        [
          { holdingId: 'a', amount: '0.20' },
          { holdingId: 'b', amount: '0.08' },
        ],
        'UAH',
      ),
    ).toBe(true);

    // No returns at all.
    expect(canSaveSplit('10', [], 'UAH')).toBe(false);
    // A non-positive (or unparseable) payment.
    expect(canSaveSplit('0', [{ holdingId: 'a', amount: '1' }], 'UAH')).toBe(false);
    expect(canSaveSplit('', [{ holdingId: 'a', amount: '1' }], 'UAH')).toBe(false);
    // A return with no holding picked.
    expect(canSaveSplit('10', [{ holdingId: null, amount: '1' }], 'UAH')).toBe(false);
    // A return that targets the payer itself is NOW allowed (item 2): the net is
    // still an expense (return < payment) and the balance nets on the payer with
    // no double-count, so a payer return is a valid split.
    expect(canSaveSplit('10', [{ holdingId: 'payer', amount: '1' }], 'UAH')).toBe(true);
    // Two returns on the SAME holding (the repo has no runtime guard — this is
    // the enforcement point).
    expect(
      canSaveSplit(
        '10',
        [
          { holdingId: 'a', amount: '1' },
          { holdingId: 'a', amount: '1' },
        ],
        'UAH',
      ),
    ).toBe(false);
    // A non-positive return amount.
    expect(canSaveSplit('10', [{ holdingId: 'a', amount: '0' }], 'UAH')).toBe(false);
    // Σ returns equals the payment (net zero is not an expense).
    expect(
      canSaveSplit(
        '2',
        [
          { holdingId: 'a', amount: '1' },
          { holdingId: 'b', amount: '1' },
        ],
        'UAH',
      ),
    ).toBe(false);
    // Validated in INTEGER minor units, not float-major: 0.10 + 0.20 = 30 minor
    // units, strictly below 0.31 = 31 minor units, so the sub-unit boundary holds
    // exactly rather than through fragile float arithmetic.
    expect(
      canSaveSplit(
        '0.31',
        [
          { holdingId: 'a', amount: '0.10' },
          { holdingId: 'b', amount: '0.20' },
        ],
        'UAH',
      ),
    ).toBe(true);
  });
});

// Fixtures for convert prefill: a SYNCED monobank USD card
// withdrawal (`w1`, -20.00 USD) and a UAH cash destination to convert into.
const PREFILL_HOLDINGS: Holding[] = [
  {
    id: 'card-usd',
    currency: 'USD',
    balanceMinorUnits: 0,
    type: 'card',
    name: 'Card USD',
    accountId: 'acc',
  },
  {
    id: 'cash-uah',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Cash UAH',
    accountId: 'acc',
  },
];

const PREFILL_ACCOUNTS: Account[] = [{ id: 'acc', name: 'Home' }];

const PREFILL_TXN: Transaction = {
  id: 'w1',
  holdingId: 'card-usd',
  amountMinorUnits: -20_00,
  time: 42,
  description: 'ATM withdrawal',
  source: 'monobank',
};

describe('TransactionFormScreen — convert counterpart prefill', () => {
  const renderConvert = (rates: Rate[]): ReturnType<typeof render> => {
    setLiveData(PREFILL_HOLDINGS, PREFILL_TXN, CATEGORIES, PREFILL_ACCOUNTS, rates);
    const route = transactionFormRoute({ transactionId: 'w1' });

    return render(<TransactionFormScreen route={route} navigation={navigationProp} />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefills the counterpart amount from the latest cached rate on picking a destination', async () => {
    const utils = await renderConvert([{ base: 'USD', quote: 'UAH', rate: '41.5' }]);

    await fireEvent.press(utils.getByText('Exchange'));
    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash UAH'));

    // 20.00 USD × 41.5 = 830.00 UAH, shown as the grouped major string "830".
    await waitFor(() => expect(utils.getByLabelText('Value in').props.value).toBe('830'));
    // The synced bank row is never mutated by a form-field prefill.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Part A (bug-hunt fix): `buildRateTable` now falls back to the bundled fiat
  // rate seed when `currency_rates` has no live row for a pair — a supported
  // fiat pair therefore ALWAYS resolves, never `null`, so this no longer proves
  // the blank-field path (see `exchange-prefill.test.ts`'s own "returns null
  // when no cached rate exists", unaffected by the seed since it hand-builds
  // its `RateTable` rather than going through `buildRateTable`). This proves
  // the offline/fresh-install case instead: an EMPTY `currency_rates` table
  // still prefills an approximate value through the seed, rather than leaving
  // the field blank until the first live sync ever completes.
  it('prefills the counterpart amount from the bundled fiat seed when no live rate is cached', async () => {
    const utils = await renderConvert([]);

    await fireEvent.press(utils.getByText('Exchange'));
    await fireEvent.press(utils.getByLabelText('To'));
    await fireEvent.press(utils.getByText('Cash UAH'));

    // 20.00 USD × the seed's USD:UAH (44.6) = 892.00 UAH — an APPROXIMATE
    // value until a live rate replaces it, unlike the exact 830 the live-rate
    // test above locks in for the same holdings at a different (live) rate.
    await waitFor(() => expect(utils.getByLabelText('Value in').props.value).toBe('892'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
