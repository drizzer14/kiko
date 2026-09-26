import { right } from 'fnts/either';
import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { Money } from '@kiko/currency/money';
import { holdingsRepo } from '@kiko/holdings/repo';
import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';

import { i18n } from '../../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';
import { dayKeyOf } from '../../../prices/price-book';
import { darkTheme } from '../../../design-system/theme';
import type { Metal } from '../../../holdings/holding-metadata';
import type { HoldingType } from '../../../holdings/holding-type';
import { scrollToField } from '../scroll-to-field/scroll-to-field';
import { refreshBondRegisterIfStale } from '../../../bonds/bond-register-repo';

import HoldingFormScreen from './holding-form.screen';

type HoldingFormProps = ComponentProps<typeof HoldingFormScreen>;

const navigationProp = (spy: ReturnType<typeof navigationSpy>) =>
  asNavigationProp<HoldingFormProps['navigation']>(spy);

const { entityColors } = darkTheme.colors;

const HEX = /^#[0-9a-f]{6}$/i;

// Finds which theme entity-color swatch (if any) the ColorPicker currently
// marks selected, by its accessibility label, and resolves it back to a hex.
// `undefined` means no swatch matches the form's current effective color —
// the failure mode a stored '' used to produce.
const selectedSwatchHex = (
  getByLabelText: Awaited<ReturnType<typeof render>>['getByLabelText'],
): string | undefined => {
  for (const [name, hex] of Object.entries(entityColors)) {
    if (getByLabelText(`Color ${name}`).props.accessibilityState.selected) {
      return hex;
    }
  }
  return undefined;
};

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    create: jest.fn().mockResolvedValue('new-holding-id'),
    setIcon: jest.fn(),
    update: jest.fn(),
    updateWithBalanceDelta: jest.fn(),
    updateLoan: jest.fn(),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    allQuery: () => ({ __kind: 'all', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

// The account whose kind constrains the offered holding types. `mock`-prefixed
// so the hoisted jest.mock factory may close over it; each test can reassign it
// before rendering to exercise a different account kind.
let mockAccountKind = 'bank';
// The account's live sync connection. A holding only counts as synced while its
// account is still connected: a disconnect KEEPS the holding's sync key (so a
// reconnect re-adopts the row), so the institution is what decides. Defaults to
// a SYNCED (Monobank) account so the many tests below that don't care about
// sync status keep exercising the pre-existing term_deposit-default bank
// behavior; only the tests exercising the non-synced (statement-import-only)
// path override this to null.
let mockAccountInstitution: string | null = 'monobank';
// The account's `bankId`: gates the `metal` holding type under a
// `bank`-kind account (see `creatableHoldingTypesForAccount`'s allow-list).
// `null` by default (no bank picked); only the metal-allow-list tests below
// override it.
let mockAccountBankId: string | null = null;
// The holding the edit-mode form loads through useLiveQuery. Empty by default
// (create mode); edit-mode tests seed it before rendering.
let mockEditHoldings: unknown[] = [];
// The `bond_register` cache rows the ISIN-mode section's lookup reads.
// Empty by default — the "no match" / "offline with no cache" path — so a
// test only sets this when it needs a found bond.
let mockBondRegisterRows: unknown[] = [];
// The `fetchedAtQuery` cache-populated marker.
// Non-null by default (a cache exists) — most tests care about a FOUND vs.
// NOT-FOUND match, not the "never loaded" distinction.
let mockBondRegisterFetchedAtRows: { value: number | null }[] = [{ value: 1 }];
// The `price_points` rows `usePriceBook()` reads —
// a loan edit's `buildLoanPricePointOp` (a) case needs an existing manual
// correction to anchor the outstanding it preserves. Empty by default; only
// the (a)-case test below seeds a correction.
let mockPricePoints: unknown[] = [];
// The loan form's own "Paid from" picker options source — every OTHER
// holding, distinct from `mockEditHoldings` (the ONE holding being edited).
// Both subscribe under the same `['holdings']` key, so `__kind` (set on the
// mocked `holdingsRepo.allQuery` below) tells them apart, mirroring the
// `bond_register` `fetchedAt`/`findByIsin` split above. Empty by default;
// only a test exercising the "Paid from" field seeds it.
let mockAllHoldings: unknown[] = [];
// Every account, keyed the same way against `accountsRepo.byIdQuery`'s own
// single-row subscription (both use the `['accounts']` key).
let mockAllAccounts: unknown[] = [];

const mockUseLiveQuery = jest.fn(
  (query: { __kind?: string }, keys: string[], _enabled?: boolean) => {
    if (keys[0] === 'holdings') {
      return { data: query.__kind === 'all' ? mockAllHoldings : mockEditHoldings };
    }
    if (keys[0] === 'accounts' && query.__kind === 'list') {
      return { data: mockAllAccounts };
    }
    if (keys[0] === 'bond_register') {
      return query.__kind === 'fetchedAt'
        ? { data: mockBondRegisterFetchedAtRows }
        : { data: mockBondRegisterRows };
    }
    if (keys[0] === 'price_points') {
      return { data: mockPricePoints };
    }
    return {
      data: [
        {
          id: 'acc-1',
          kind: mockAccountKind,
          institution: mockAccountInstitution,
          bankId: mockAccountBankId,
        },
      ],
    };
  },
);

jest.mock('../../../db/use-live-query', () => ({
  // Key on the subscribed table: the holdings query drives edit-mode hydration,
  // the accounts query drives the allowed-type filter and the sync gate, and
  // the bond_register query drives the ISIN-mode lookup. Both
  // `findByIsinQuery` and `fetchedAtQuery` subscribe under the SAME
  // 'bond_register' key, so the query object's own `__kind` (set by the
  // mocked `bondRegisterRepo` below) tells them apart.
  useLiveQuery: (...args: [{ __kind?: string }, string[], boolean?]) => mockUseLiveQuery(...args),
}));
// `findByIsinQuery`/`fetchedAtQuery`'s return values are opaque to the
// mocked `useLiveQuery` above (it only reads `__kind`), so a bare stub is
// enough — the same pattern `accountsRepo.byIdQuery` uses below.
// `refreshBondRegisterIfStale` is mocked so no test hits
// a real network `fetch`; each relevant test can assert it was invoked.
jest.mock('../../../bonds/bond-register-repo', () => ({
  bondRegisterRepo: {
    findByIsinQuery: () => ({ __kind: 'findByIsin', toSQL: () => ({ sql: '', params: [] }) }),
    fetchedAtQuery: () => ({ __kind: 'fetchedAt', toSQL: () => ({ sql: '', params: [] }) }),
  },
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    listQuery: () => ({ __kind: 'list', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
// The first-add refresh trigger (a create's own follow-up, kiko-architecture):
// spied so a test can assert it runs after a CREATE and not after an EDIT,
// without exercising the real gated repos.
const mockRefreshMarketData = jest.fn().mockResolvedValue(right(undefined));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));
// The loan auto-link matcher's own follow-up after a loan create/edit —
// spied the same way, so a test can assert it fires only for `type: 'loan'`.
const mockRunLoanAutoLink = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));
// Auto-mocked so the scroll-order tests below can assert on WHICH field ref a
// rejected Save targets, without a real ScrollView/measureLayout in the test
// environment (mirrors contribution-form's and account-form's own mock).
jest.mock('../scroll-to-field/scroll-to-field');

const navigation = navigationSpy();
const route = asRouteProp<HoldingFormProps['route']>('HoldingForm', { accountId: 'acc-1' });

const createMock = holdingsRepo.create as jest.Mock;
const setIconMock = holdingsRepo.setIcon as jest.Mock;
const updateMock = holdingsRepo.update as jest.Mock;
// An edit saves through `updateWithBalanceDelta`, which writes the patch AND the
// balance difference as a manual ledger row in one transaction (see
// holdings.repo.ts). `update`'s bare `set(patch)` is kept mocked so a test can
// prove the form never falls back to it for a balance edit.
const updateDeltaMock = holdingsRepo.updateWithBalanceDelta as jest.Mock;
// A loan edit saves through `updateLoan` instead —
// the metadata patch AND the manual `holding:<id>` price-point op commit in
// the SAME transaction, so the series can never drift from the edit.
const updateLoanMock = holdingsRepo.updateLoan as jest.Mock;

beforeEach(() => {
  mockAccountKind = 'bank';
  mockAccountInstitution = 'monobank';
  mockAccountBankId = null;
  mockEditHoldings = [];
  mockBondRegisterRows = [];
  mockBondRegisterFetchedAtRows = [{ value: 1 }];
  mockPricePoints = [];
  mockAllHoldings = [];
  mockAllAccounts = [];
});

const renderScreen = () =>
  render(<HoldingFormScreen navigation={navigationProp(navigation)} route={route} />);

// Render the form in EDIT mode against a seeded holding, keyed by its id.
const renderEdit = (holding: Record<string, unknown>) => {
  mockEditHoldings = [holding];
  const editRoute = asRouteProp<HoldingFormProps['route']>('HoldingForm', {
    accountId: 'acc-1',
    holdingId: holding.id,
  });

  return render(<HoldingFormScreen navigation={navigationProp(navigation)} route={editRoute} />);
};

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const fill = async (screen: Screen, label: string, value: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText(label), value);
};

// The holding-type field is a select sheet (HoldingTypeField on
// SelectField), not an inline ChipRow: a type press has to open the sheet
// first, then press the option row — keyed on the underlying HoldingType
// value (not the display label), since the trigger and a still-selected
// row can show the SAME label text at once.
const openHoldingTypeSheet = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByTestId('holding-type-field'));
};

// A metal shows as its own row in the Type sheet (`MetalTypeField`), so a
// metal is picked by its element code instead of the generic `metal` type.
const typeOptionIds = (screen: Screen): string[] =>
  screen.getAllByTestId(/^holding-type-field-option-/).map((row) => String(row.props.testID));

const metalOptionIds = ['XAU', 'XAG', 'XPT', 'XPD'].map(
  (metal) => `holding-type-field-option-${metal}`,
);

const selectHoldingTypeOption = async (screen: Screen, option: HoldingType | Metal) => {
  await fireEvent.press(screen.getByTestId(`holding-type-field-option-${option}`));
};

const selectHoldingType = async (screen: Screen, type: HoldingType | Metal): Promise<void> => {
  await openHoldingTypeSheet(screen);
  await selectHoldingTypeOption(screen, type);
};

// A local-midnight timestamp for the given calendar day, matching what the
// DateField reports from a `react-native-calendars` day press (never UTC).
const localDay = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

// Drive the DateField's calendar: open its sheet, then fire the mocked
// Calendar's `onDayPress` with the picked day. The DateField stores a
// local-midnight timestamp and closes the sheet.
const pickDate = async (
  screen: Screen,
  label: string,
  year: number,
  month: number,
  day: number,
): Promise<void> => {
  await fireEvent.press(screen.getByLabelText(label));
  await fireEvent(screen.getByTestId(`${label} calendar`), 'dayPress', {
    year,
    month,
    day,
    dateString: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: 0,
  });
};

// A bond CREATE defaults to ISIN mode; every test here exercises the
// classic Manual-mode fields, so it switches over first.
const fillBondFields = async (screen: Screen): Promise<void> => {
  await selectHoldingType(screen, 'bond');
  await fireEvent.press(screen.getByText('Manual'));
  await fill(screen, 'Name', 'My bond');
  await fill(screen, 'Quantity', '10');
  await fill(screen, 'Face value', '1000');
  await fill(screen, 'Coupon %', '9');
  await pickDate(screen, 'Purchase date', 2026, 1, 1);
  await pickDate(screen, 'Maturity date', 2028, 1, 1);
};

const fillTermDepositFields = async (screen: Screen): Promise<void> => {
  await selectHoldingType(screen, 'term_deposit');
  await fill(screen, 'Name', 'My deposit');
  await fill(screen, 'Contribution 1 amount', '1000');
  await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
  await fill(screen, 'Annual rate %', '12');
  await fill(screen, 'Term (months)', '12');
};

const metadataOfFirstCreate = (): Record<string, unknown> => createMock.mock.calls[0][0].metadata;

describe('HoldingFormScreen term deposit', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('screen-scroll-view')).toBeTruthy();
    // The static stack header title "Add Holding" is now the single title; the
    // in-body duplicate is gone.
    expect(queryByText('Add Holding')).toBeNull();
  });

  it('renders a visible text label above every simple-holding field', async () => {
    // A simple (cash) holding takes an opening balance, so Name, Type, Currency,
    // Balance are all present. A bank create defaults to a term deposit instead
    // (its own fields are covered below), so this uses a cash account.
    mockAccountKind = 'cash';
    const { getByText } = await renderScreen();

    for (const label of ['Name', 'Type', 'Currency', 'Balance']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('offers crypto currencies for a holding (BTC and UAH present)', async () => {
    // A holding may legitimately be in a crypto currency, so — unlike the cash
    // account form — the holding currency picker keeps the FULL set: opening the
    // field offers both fiat (UAH) and crypto (BTC).
    const { getByTestId, getByPlaceholderText } = await renderScreen();

    await fireEvent.press(getByTestId('holding-currency-field'));

    // UAH is the first option, so it renders eagerly — a fiat is offered.
    expect(getByTestId('currency-option-UAH')).toBeTruthy();

    // BTC is the last currency, so the virtualized list does not mount it
    // eagerly; search for it (as currency-field.component.test.tsx does) to
    // prove the holding picker still offers crypto.
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'BTC');
    expect(getByTestId('currency-option-BTC')).toBeTruthy();
  });

  // DEVICE BUG fix (root cause): the currency sheet's search field lives
  // inside a Modal above this Screen's background ScrollView, which
  // otherwise misfires `automaticallyAdjustKeyboardInsets` for a responder
  // it does not contain. `CurrencyField`'s `onOpenChange` must gate that
  // prop off for exactly the window the sheet is open.
  it('suspends automaticallyAdjustKeyboardInsets on the background ScrollView while the currency sheet is open', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(true);

    await fireEvent.press(getByTestId('holding-currency-field'));

    expect(getByTestId('screen-scroll-view').props.automaticallyAdjustKeyboardInsets).toBe(false);
  });

  it('does not render the opening Balance input for a term deposit', async () => {
    // A simple (cash) holding shows the Balance input.
    mockAccountKind = 'cash';
    const cash = await renderScreen();
    expect(cash.getByLabelText('Balance')).toBeTruthy();

    // A bank create defaults to a term deposit, whose value derives from its
    // contributions, not an opening balance — so the Balance input is dropped to
    // avoid a dead, misleading field.
    mockAccountKind = 'bank';
    const deposit = await renderScreen();
    expect(deposit.queryByLabelText('Balance')).toBeNull();
  });

  it('separates the color picker and every sub-heading with form dividers (term deposit)', async () => {
    // A bank create defaults to a term deposit: one divider after the color
    // picker, one before "Contributions", one before "Terms".
    const { getAllByTestId } = await renderScreen();

    expect(getAllByTestId('form-divider')).toHaveLength(3);
  });

  it('separates the color picker and the details sub-heading with form dividers (bond)', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    // One divider after the color picker, one before "Details".
    expect(screen.getAllByTestId('form-divider')).toHaveLength(2);
  });

  it('renders a visible text label above every term-deposit field', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');

    // The repeatable contributions list starts with one row.
    expect(screen.getByLabelText('Contribution 1 amount')).toBeTruthy();
    expect(screen.getByLabelText('Contribution 1 date')).toBeTruthy();
    expect(screen.getByText('Add contribution')).toBeTruthy();

    for (const label of ['Annual rate %', 'Term (months)', 'Recapitalization', 'Compounding']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders a visible text label above every ISIN-mode bond field, defaulting to ISIN mode', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    // ISIN mode (the CREATE default) shows quantity/purchase date —
    // always visible — plus the mode toggle and the ISIN field itself.
    for (const label of ['Quantity', 'Purchase date', 'Purchase price (total paid)']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByPlaceholderText('UA4000234215')).toBeTruthy();
  });

  it('renders a visible text label above every Manual-mode bond field', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));

    for (const label of [
      'Quantity',
      'Face value',
      'Coupon %',
      'Purchase date',
      'Maturity date',
      'Bond kind',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('saves a term_deposit with a single contribution in its metadata', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.principalMinorUnits).toBeUndefined();
    expect(metadata.startDate).toBeUndefined();
    expect(metadata.annualRatePct).toBe(12);
    expect(metadata.termMonths).toBe(12);
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
    ]);
  });

  it('creates a deposit with two contributions', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);

    await fireEvent.press(screen.getByText('Add contribution'));

    await fill(screen, 'Contribution 2 amount', '500');
    await pickDate(screen, 'Contribution 2 date', 2026, 2, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.contributions).toHaveLength(2);
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
      { amountMinorUnits: 50_000, date: localDay(2026, 2, 1) },
    ]);
  });

  // Every scroll-on-add-row trigger, not only "Додати внесок" (add
  // contribution) itself, must route
  // through the SAME occlusion-aware `scrollToField` helper the Save-invalid
  // path already uses — never an unconditional `scrollToEnd`, which used to
  // scroll even when the newly added row was already fully visible.
  it('scrolls to the newly added contribution through the occlusion-aware scrollToField helper, not an unconditional scrollToEnd', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const rafSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    scrollToFieldMock.mockClear();
    await fireEvent.press(screen.getByText('Add contribution'));

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

  it('targets the newly appended row (not a fixed one) on each Add contribution press', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    const rafSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    scrollToFieldMock.mockClear();
    await fireEvent.press(screen.getByText('Add contribution'));
    // The SAME `lastContributionFieldRef` object is passed on every call — a
    // ref container never changes identity — so the newest-row proof reads
    // its mutable `.current` at each point in time, not the ref object itself.
    const [, rowRef] = scrollToFieldMock.mock.calls[0];
    const secondRowNode = rowRef.current;

    scrollToFieldMock.mockClear();
    await fireEvent.press(screen.getByText('Add contribution'));
    const thirdRowNode = rowRef.current;

    expect(thirdRowNode).not.toBeNull();
    expect(thirdRowNode).not.toBe(secondRowNode);

    rafSpy.mockRestore();
  });

  it('blocks save and shows an inline error on a new contribution row left blank', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    // Add a second row but leave it blank.
    await fireEvent.press(screen.getByText('Add contribution'));

    await fireEvent.press(screen.getByText('Save'));

    // The blank second row blocks save entirely — it must not be silently
    // dropped, taking only the first (filled) row with it.
    expect(createMock).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId('contributions-group')).getByText(
        "Fill in this contribution's amount and date, or remove it.",
      ),
    ).toBeTruthy();
  });

  it('blocks save on a new contribution row that has only an amount, no date', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    await fireEvent.press(screen.getByText('Add contribution'));
    // Partially filled: an amount but no picked date.
    await fill(screen, 'Contribution 2 amount', '500');

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Fill in this contribution's amount and date, or remove it."),
    ).toBeTruthy();
  });

  it('creates the deposit once the second row is filled in, clearing its inline error', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');
    await fireEvent.press(screen.getByText('Add contribution'));
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText("Fill in this contribution's amount and date, or remove it."),
    ).toBeTruthy();

    await fill(screen, 'Contribution 2 amount', '500');
    await pickDate(screen, 'Contribution 2 date', 2026, 2, 1);

    expect(
      screen.queryByText("Fill in this contribution's amount and date, or remove it."),
    ).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
      { amountMinorUnits: 50_000, date: localDay(2026, 2, 1) },
    ]);
  });

  it('saves once the blank second row is removed instead of filled in', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');
    await fireEvent.press(screen.getByText('Add contribution'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Remove contribution 2'));
    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
    ]);
  });

  it('does not save a deposit when no contribution row is valid', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
  });

  it('removes a contribution row via its remove control', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fireEvent.press(screen.getByText('Add contribution'));

    expect(screen.getByLabelText('Contribution 2 amount')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Remove contribution 2'));

    expect(screen.queryByLabelText('Contribution 2 amount')).toBeNull();
  });

  it('saves a bond with a metadata block', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate()).toEqual(
      expect.objectContaining({
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 9,
        purchaseDate: localDay(2026, 1, 1),
        maturityDate: localDay(2028, 1, 1),
        bondKind: 'government',
      }),
    );
  });

  it('creates a corporate bond when the corporate chip is selected', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    await fireEvent.press(screen.getByText('Corporate'));

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().bondKind).toBe('corporate');
  });

  it('defaults a new deposit to non-recapitalizing (payout)', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().recapitalization).toBe(false);
  });

  it('records recapitalization when the switch is toggled on', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().recapitalization).toBe(true);
  });

  it('renders a coupon-frequency selector defaulting to semiannually in the bond metadata', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    expect(screen.getByText('Coupon frequency')).toBeTruthy();

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().couponFrequency).toBe('semiannually');
  });

  it('stores the chosen coupon frequency', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    // Coupon frequency is a select sheet (SelectField), not an inline chip.
    await fireEvent.press(screen.getByTestId('manual-bond-coupon-frequency-field'));
    await fireEvent.press(
      screen.getByTestId('manual-bond-coupon-frequency-field-option-quarterly'),
    );

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().couponFrequency).toBe('quarterly');
  });
});

describe('HoldingFormScreen bond ISIN mode', () => {
  beforeEach(() => {
    createMock.mockClear();
    (refreshBondRegisterIfStale as jest.Mock).mockClear();
  });

  const isinInput = (screen: Screen) => screen.getByPlaceholderText('UA4000234215');

  const foundRegisterRow = {
    isin: 'UA4000234215',
    terms: {
      isin: 'UA4000234215',
      currency: 'USD',
      faceValueMinorUnits: 100_000,
      couponPct: 9.5,
      maturityDate: localDay(2029, 6, 24),
      couponFrequency: 'quarterly',
      name: 'Register Bond UA4000234215',
    },
    fetchedAt: 1,
  };

  it('defaults a bond create to ISIN mode', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    expect(
      screen.getByTestId('bond-isin-mode-control-option-isin').props.accessibilityState.selected,
    ).toBe(true);
  });

  it('calls refreshBondRegisterIfStale once the bond section opens', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    expect(refreshBondRegisterIfStale).toHaveBeenCalledTimes(1);
  });

  it('fills face value, coupon, maturity, frequency, bondKind, currency, and name once a found ISIN resolves, and saves BondMeta with the isin', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    // The read-only summary reflects the found terms.
    expect(within(screen.getByTestId('bond-isin-summary')).getByText(/9\.5/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const call = createMock.mock.calls[0][0];
    expect(call.name).toBe('Register Bond UA4000234215');
    expect(call.currency).toBe('USD');
    expect(call.metadata).toEqual(
      expect.objectContaining({
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 9.5,
        maturityDate: localDay(2029, 6, 24),
        couponFrequency: 'quarterly',
        bondKind: 'government',
        isin: 'UA4000234215',
      }),
    );
  });

  it('shows a "not in the register" message with a Switch to manual button, keeping the typed ISIN, when the ISIN is not cached (also covers offline with no cache)', async () => {
    mockBondRegisterRows = [];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');

    expect(screen.getByText('Not in the NBU register.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Switch to manual'));

    // Manual mode now shows the same ISIN, still editable.
    expect(
      screen.getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(true);
    expect(isinInput(screen).props.value).toBe('UA4000234215');
  });

  it('blocks save with a check-digit error for an invalid ISIN', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    // A valid-shaped ISIN with a wrong check digit.
    await fireEvent.changeText(isinInput(screen), 'UA4000227046');

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('ISIN check digit is wrong.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('renders the Diia hint in both ISIN and Manual mode', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    expect(
      screen.getByText('Bought in Diia? Add the bond under the bank or broker you chose there.'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByText('Manual'));

    expect(
      screen.getByText('Bought in Diia? Add the bond under the bank or broker you chose there.'),
    ).toBeTruthy();
  });

  it('opens edit mode in Manual with the stored ISIN shown and editable', async () => {
    const screen = await renderEdit({
      ...bondHolding,
      metadata: { ...bondHolding.metadata, isin: 'UA4000234215' },
    });

    expect(
      screen.getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(true);
    expect(isinInput(screen).props.value).toBe('UA4000234215');

    await fireEvent.changeText(isinInput(screen), 'XS2895055981');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.metadata.isin).toBe('XS2895055981');
  });

  // The found-terms apply must not re-fire on an
  // unrelated change — renaming the holding after a match, then picking a
  // date, must save the TYPED name, not the register's.
  it('keeps a renamed holding name after a found ISIN, even after a later purchase-date pick', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    expect(screen.getByDisplayValue('Register Bond UA4000234215')).toBeTruthy();

    await fill(screen, 'Name', 'War bond 2029');
    await pickDate(screen, 'Purchase date', 2026, 1, 1);

    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].name).toBe('War bond 2029');
  });

  // A match resolved while the user is in MANUAL
  // mode must still apply the first time they later switch to ISIN — the
  // register lookup itself never depended on `bondMode`, only the apply did.
  it('applies a match found while in Manual mode once the user switches to ISIN', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');

    // Still in Manual — nothing applied yet.
    expect(screen.queryByDisplayValue('Register Bond UA4000234215')).toBeNull();

    await fireEvent.press(screen.getByTestId('bond-isin-mode-control-option-isin'));
    await fill(screen, 'Quantity', '10');

    expect(within(screen.getByTestId('bond-isin-summary')).getByText(/9\.5/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const call = createMock.mock.calls[0][0];
    expect(call.name).toBe('Register Bond UA4000234215');
    expect(call.metadata).toEqual(
      expect.objectContaining({
        couponFrequency: 'quarterly',
        bondKind: 'government',
        isin: 'UA4000234215',
      }),
    );
  });

  // An unmapped `pay_period`
  // auto-switches to Manual once; re-tapping ISIN for that SAME match shows
  // its own coupon-frequency picker with NO default and blocks Save until
  // one is picked — never a frequency the user never chose.
  it('blocks save with a visible reason until a coupon frequency is picked for an unmapped-frequency ISIN match, then saves the picked frequency', async () => {
    mockBondRegisterRows = [
      { ...foundRegisterRow, terms: { ...foundRegisterRow.terms, couponFrequency: null } },
    ];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    // Auto-switched to Manual for the unmapped frequency.
    expect(
      screen.getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(true);

    await fireEvent.press(screen.getByTestId('bond-isin-mode-control-option-isin'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('No coupon frequency selected.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('bond-coupon-frequency-field'));
    await fireEvent.press(screen.getByTestId('bond-coupon-frequency-field-option-quarterly'));
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].metadata.couponFrequency).toBe('quarterly');
  });

  // A matured-still-registered bond
  // must block Save with a VISIBLE reason in ISIN mode — the
  // maturity DateField itself is unmounted there.
  it('shows a visible maturity-after-purchase error in ISIN mode for a matured-still-registered bond', async () => {
    mockBondRegisterRows = [
      {
        isin: 'UA4000234215',
        terms: { ...foundRegisterRow.terms, maturityDate: localDay(2020, 1, 1) },
        fetchedAt: 1,
      },
    ];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Maturity date must be after the purchase date.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  // The purchase-date field's own "missing" reason must never misfire in
  // ISIN mode, where `useBondIsinMode` already defaults it to today the
  // moment the bond section opens.
  it('never shows a purchase-date reason in ISIN mode, since it auto-fills to today', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.queryByText('No purchase date selected.')).toBeNull();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  // In edit mode, a found ISIN in a DIFFERENT
  // currency than the (locked) holding currency must not silently apply,
  // and must block save with its own visible reason.
  it('does not apply a found ISIN in a different currency in edit mode, and blocks save', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderEdit(bondHolding);

    expect(bondHolding.currency).toBe('UAH');

    await fireEvent.press(screen.getByTestId('bond-isin-mode-control-option-isin'));
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');

    expect(screen.queryByDisplayValue('Register Bond UA4000234215')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText("This ISIN's currency doesn't match the holding's currency."),
    ).toBeTruthy();
    expect(updateDeltaMock).not.toHaveBeenCalled();
  });
});

describe('HoldingFormScreen section titles', () => {
  it('renders "Contributions" and "Terms" section titles in the term-deposit block', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');

    expect(screen.getByText('Contributions')).toBeTruthy();
    expect(screen.getByText('Terms')).toBeTruthy();
  });

  it('renders the "Details" section title in the bond block', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    expect(screen.getByText('Details')).toBeTruthy();
  });
});

describe('HoldingFormScreen save validation', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
  });

  it('keeps Save always enabled for a term deposit missing its contribution, rate, and term', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('does not create and shows no reason before Save is pressed, for an incomplete term deposit', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');

    expect(
      screen.queryByText('Add at least one contribution with an amount and a date.'),
    ).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows an inline reason for a term deposit missing its contribution, rate, and term, only after Save is pressed', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText('Add at least one contribution with an amount and a date.'),
    ).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows the annual-rate error directly on that field, not only after unrelated fields below it', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a rate of 0 or higher.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Annual rate %').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows the term reason directly on that field, once the rate is set but the term is missing', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Term (months)').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('names the maximum once the term deposit term exceeds MAX_TERM_MONTHS', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', String(MAX_TERM_MONTHS + 1));
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText(`Enter a whole number of months from 1 to ${MAX_TERM_MONTHS}.`),
    ).toBeTruthy();
  });

  it('shows the contributions-required reason inside the contributions group, anchored to the first row', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));

    expect(
      within(screen.getByTestId('contributions-group')).getByText(
        'Add at least one contribution with an amount and a date.',
      ),
    ).toBeTruthy();
  });

  it('clears the term-deposit reason once every field becomes valid, without a second Save press', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));
    expect(
      screen.getByText('Add at least one contribution with an amount and a date.'),
    ).toBeTruthy();

    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '12');

    expect(
      screen.queryByText('Add at least one contribution with an amount and a date.'),
    ).toBeNull();
    expect(screen.queryByText('Enter a rate of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Enter a whole number of months greater than 0.')).toBeNull();
  });

  it('shows the annual-rate and term-months errors together at the same Save press, each clearing only its own field', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a rate of 0 or higher.')).toBeTruthy();
    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();

    await fill(screen, 'Annual rate %', '12');

    expect(screen.queryByText('Enter a rate of 0 or higher.')).toBeNull();
    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();

    await fill(screen, 'Term (months)', '12');

    expect(screen.queryByText('Enter a whole number of months greater than 0.')).toBeNull();
  });

  it('keeps Save always enabled for a bond missing its numeric fields and dates', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fill(screen, 'Name', 'My bond');

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('does not create a bond whose maturity is not after its purchase date, and shows the reason directly under the maturity date field', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face value', '1000');
    await fill(screen, 'Coupon %', '9');
    await pickDate(screen, 'Purchase date', 2026, 1, 1);
    await pickDate(screen, 'Maturity date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(
      within(screen.getByTestId('maturity-date-field')).getByText(
        'Maturity date must be after the purchase date.',
      ),
    ).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates a bond once every field and date is valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it('shows the quantity reason directly on that field, for a bond missing its numeric fields', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fill(screen, 'Name', 'My bond');

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Quantity').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows the face-value reason directly on that field, once quantity is set but face value is missing', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a face value greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Face value').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows the coupon reason directly on that field, once face value is set but the coupon is missing', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face value', '1000');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a coupon of 0 or higher.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Coupon %').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows no bond reason once every field and date is valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a face value greater than 0.')).toBeNull();
    expect(screen.queryByText('Enter a coupon of 0 or higher.')).toBeNull();
    expect(screen.queryByText('Maturity date must be after the purchase date.')).toBeNull();
  });

  it('shows the quantity and face-value errors together at the same Save press, each clearing only its own field', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Name', 'My bond');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(screen.getByText('Enter a face value greater than 0.')).toBeTruthy();

    await fill(screen, 'Quantity', '10');

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();
    expect(screen.getByText('Enter a face value greater than 0.')).toBeTruthy();

    await fill(screen, 'Face value', '1000');

    expect(screen.queryByText('Enter a face value greater than 0.')).toBeNull();
  });

  // A Manual-mode bond missing its maturity date used to fail Save with no
  // visible reason at all (`isBondValid` blocked it, but neither
  // `bondReasonKey` nor the scroll target knew why) — the purchase date has
  // the identical gap in the code, but is untestable through this screen:
  // `useBondIsinMode`'s own effect defaults it to today the instant the bond
  // section opens, in EITHER mode, before a test can ever observe it null.
  it('shows the maturity-date reason directly on that field, for a Manual-mode bond missing its maturity date', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face value', '1000');
    await fill(screen, 'Coupon %', '9');
    await pickDate(screen, 'Purchase date', 2026, 1, 1);

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('No maturity date selected.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('keeps Save always enabled when the holding name is blank, and pressing it neither creates nor navigates', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('Save')).not.toBeDisabled();

    await fireEvent.press(getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the name-required reason only after a failed Save, for a blank holding name', async () => {
    const { getByText, queryByTestId } = await renderScreen();

    expect(queryByTestId('holding-name-error')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(queryByTestId('holding-name-error')).toBeTruthy();
  });

  it('scrolls to a DIFFERENT field target as each earlier one becomes valid, in the term-deposit priority order', async () => {
    const scrollToFieldMock = scrollToField as jest.Mock;
    scrollToFieldMock.mockClear();
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fireEvent.press(screen.getByText('Save'));
    const [, contributionsRef] = scrollToFieldMock.mock.calls[0];

    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Save'));
    const [, annualRateRef] = scrollToFieldMock.mock.calls[1];

    expect(annualRateRef).not.toBe(contributionsRef);

    await fill(screen, 'Annual rate %', '12');
    await fireEvent.press(screen.getByText('Save'));
    const [, termMonthsRef] = scrollToFieldMock.mock.calls[2];

    expect(termMonthsRef).not.toBe(annualRateRef);
    expect(termMonthsRef).not.toBe(contributionsRef);
  });

  it('surfaces an alert and does not navigate when the create fails', async () => {
    createMock.mockRejectedValueOnce(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const screen = await renderScreen();
    await fillTermDepositFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('HoldingFormScreen property', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
    updateDeltaMock.mockClear();
    mockAccountKind = 'property';
    mockAccountInstitution = null;
  });

  it('creates a property holding with a zero balance, one lot, and a first manual price point equal to the cost', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Apartment');
    await fill(screen, 'Cost', '5000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property_item',
        metadata: {
          category: 'real_estate',
          lots: [{ day: expect.any(Number), quantityDelta: '1', costMinorUnits: 500_000 }],
        },
        firstPricePoint: { day: expect.any(Number), price: '5000.00' },
      }),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('writes no balance TextField for a property holding (it is ledgerless)', async () => {
    const screen = await renderScreen();

    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('renders the Type field as the category picker, never the generic single-option Type sheet, and pre-selects Real estate', async () => {
    const screen = await renderScreen();

    expect(screen.queryByTestId('holding-type-field')).toBeNull();
    expect(screen.getByTestId('property-category-field')).toHaveTextContent('Real estate');

    await fireEvent.press(screen.getByTestId('property-category-field'));

    expect(screen.getByTestId('property-category-field-option-real_estate')).toBeTruthy();
    expect(screen.getByTestId('property-category-field-option-vehicle')).toBeTruthy();
    expect(screen.getByTestId('property-category-field-option-valuable')).toBeTruthy();
    expect(screen.getByTestId('property-category-field-option-business_share')).toBeTruthy();
    expect(screen.getByTestId('property-category-field-option-loan_given')).toBeTruthy();
    expect(screen.getByTestId('property-category-field-option-other')).toBeTruthy();
  });

  it("shows the picked category's glyph on the untouched icon chip", async () => {
    const screen = await renderScreen();

    expect(screen.getByLabelText('Icon house.fill')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('property-category-field'));
    await fireEvent.press(screen.getByTestId('property-category-field-option-vehicle'));

    expect(screen.getByLabelText('Icon car.fill')).toBeTruthy();
  });

  it('keeps the Type-as-category field editable (not disabled) in edit mode, unlike the generic Type field', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Apartment',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        category: 'real_estate',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    });

    expect(
      screen.getByTestId('property-category-field').props.accessibilityState?.disabled,
    ).not.toBe(true);
  });

  it('pre-selects Other when editing a property holding whose stored category is unrecognized', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Weird row',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        category: 'nonsense',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    });

    expect(screen.getByTestId('property-category-field')).toHaveTextContent('Other');
  });

  it('creates the holding under the tapped category', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My car');
    await fireEvent.press(screen.getByTestId('property-category-field'));
    await fireEvent.press(screen.getByTestId('property-category-field-option-vehicle'));
    await fill(screen, 'Cost', '5000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ category: 'vehicle' }) }),
    );
  });

  it('blocks save and shows an error for a cost of 0', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Apartment');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a cost greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('edits a property holding without a Cost field, preserving its stored lots', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Apartment',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        category: 'real_estate',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    });

    expect(screen.queryByLabelText('Cost')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: {
          category: 'real_estate',
          lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      }),
      expect.any(Number),
    );
    expect(updateDeltaMock.mock.calls[0][1]).not.toHaveProperty('balance');
  });

  it('edits a property holding onto a different category, preserving its stored lots', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Apartment',
      type: 'property_item',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        category: 'real_estate',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
      },
    });

    await fireEvent.press(screen.getByTestId('property-category-field'));
    await fireEvent.press(screen.getByTestId('property-category-field-option-vehicle'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: {
          category: 'vehicle',
          lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      }),
      expect.any(Number),
    );
  });
});

// "Add new" holding launched from the statement-import
// preview or Map Columns must end up SELECTED back there, not just created.
describe('HoldingFormScreen create-and-return', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
    navigation.navigate.mockClear();
    navigation.popTo.mockClear();
    mockAccountKind = 'property';
    mockAccountInstitution = null;
  });

  // `popTo`, not `navigate` — React
  // Navigation 7's `navigate(name, params)` PUSHES a duplicate of a route
  // already on the stack instead of reusing it
  // (`node_modules/@react-navigation/routers/src/StackRouter.tsx`'s
  // `NAVIGATE` case). This spy assertion proves PRODUCTION calls `popTo`
  // with the right args; the real-router proof that `popTo` itself reuses
  // the existing instance (no duplicate, its own state kept) lives in
  // `src/navigation/statement-import-return.navigator.test.tsx`.
  it('pops back to the StatementImport caller with holdingId merged in, instead of goBack or a duplicating navigate', async () => {
    const returnRoute = asRouteProp<HoldingFormProps['route']>('HoldingForm', {
      accountId: 'acc-1',
      returnTo: {
        screen: 'StatementImport',
        params: { filePath: '/mock/statement.csv', accountId: 'acc-1' },
      },
    });

    const screen = await render(
      <HoldingFormScreen navigation={navigationProp(navigation)} route={returnRoute} />,
    );

    await fill(screen, 'Name', 'Apartment');
    await fill(screen, 'Cost', '5000');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalled());

    expect(navigation.popTo).toHaveBeenCalledWith(
      'StatementImport',
      { filePath: '/mock/statement.csv', accountId: 'acc-1', holdingId: 'new-holding-id' },
      { merge: true },
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('StatementImport', expect.anything());
  });

  it('pops back to the ColumnMapping caller with holdingId merged in, instead of goBack or a duplicating navigate', async () => {
    const returnRoute = asRouteProp<HoldingFormProps['route']>('HoldingForm', {
      accountId: 'acc-1',
      returnTo: {
        screen: 'ColumnMapping',
        params: { filePath: '/mock/statement.csv', accountId: 'acc-1' },
      },
    });

    const screen = await render(
      <HoldingFormScreen navigation={navigationProp(navigation)} route={returnRoute} />,
    );

    await fill(screen, 'Name', 'Apartment');
    await fill(screen, 'Cost', '5000');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalled());

    expect(navigation.popTo).toHaveBeenCalledWith(
      'ColumnMapping',
      { filePath: '/mock/statement.csv', accountId: 'acc-1', holdingId: 'new-holding-id' },
      { merge: true },
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('ColumnMapping', expect.anything());
  });
});

describe('HoldingFormScreen metal', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
    updateDeltaMock.mockClear();
    mockAccountKind = 'metals';
    mockAccountInstitution = null;
    mockAccountBankId = null;
  });

  it('creates a metal holding with a zero balance and a full MetalMeta (one lot, no firstPricePoint)', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Quantity', '31.1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'metal',
        currency: 'UAH',
        metadata: {
          metal: 'XAU',
          form: 'bar',
          unit: 'oz',
          purity: '0.9999',
          lots: [{ day: expect.any(Number), quantityDelta: '31.1', costMinorUnits: 8_000_000 }],
        },
      }),
    );
    // Unlike property_item, no per-holding `firstPricePoint` is written — a
    // metal's price comes from the SHARED `metal:<XAU|...>` instrument
    // (kiko-pricing), never a per-holding series.
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('firstPricePoint');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('writes no balance TextField for a metal holding (it is ledgerless)', async () => {
    const screen = await renderScreen();

    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('hides the currency field for a metal holding, forcing UAH', async () => {
    const screen = await renderScreen();

    expect(screen.queryByTestId('holding-currency-field')).toBeNull();
  });

  it('forces the currency back to UAH when switching to metal from a non-UAH selection', async () => {
    mockAccountKind = 'bank';
    mockAccountBankId = 'privatbank';
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('holding-currency-field'));
    // Narrow by search first: unfiltered, USD sorts well outside the
    // virtualized FlatList's initial window (mirrors CurrencyField's own
    // tests).
    await fireEvent.changeText(screen.getByPlaceholderText('Search by code or name'), 'USD');
    await fireEvent.press(screen.getByTestId('currency-option-USD'));
    await selectHoldingType(screen, 'XAU');
    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Quantity', '1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ currency: 'UAH' }));
  });

  it('shows the metal-section fields once a metal is selected on an allow-listed bank account', async () => {
    mockAccountKind = 'bank';
    mockAccountBankId = 'privatbank';
    const screen = await renderScreen();

    await selectHoldingType(screen, 'XAU');

    expect(screen.getByText('Form')).toBeTruthy();
    expect(screen.getByText('Unit')).toBeTruthy();
    expect(screen.getByLabelText('Purity')).toBeTruthy();
  });

  it('blocks save and shows an error for an empty quantity and cost', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the quantity and total-cost errors together at the same Save press, each clearing only its own field', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a quantity greater than 0.')).toBeTruthy();
    expect(screen.getByText('Total cost must be greater than 0.')).toBeTruthy();

    await fill(screen, 'Quantity', '31.1');

    expect(screen.queryByText('Enter a quantity greater than 0.')).toBeNull();
    expect(screen.getByText('Total cost must be greater than 0.')).toBeTruthy();

    await fill(screen, 'Total cost', '80000');

    expect(screen.queryByText('Total cost must be greater than 0.')).toBeNull();
  });

  // A garbled purity (e.g. the comma-decimal "999,9", parsed as
  // 999.9) must never silently fall back to the standard 0.9999 fineness
  // default — that would write a valid-looking but WRONG MetalMeta with no
  // sign anything was off. Save blocks on it instead.
  it('blocks save and shows an error for a garbled purity, instead of silently defaulting it', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Purity', '999,9');
    await fill(screen, 'Quantity', '31.1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a purity between 0 and 1.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('blocks save and shows an error for an out-of-range purity greater than 1', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Purity', '1.5');
    await fill(screen, 'Quantity', '31.1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a purity between 0 and 1.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  // Purity is validated with the SAME `normalizeDecimal` parser the writer
  // uses — a leading-dot, comma-decimal, or trailing-dot shape is rejected
  // by that parser, so each of these blocks Save rather than being written
  // as some other value the user never typed.
  it.each(['.999', ',999', '1.'])(
    'blocks save and shows an error for a purity normalizeDecimal cannot parse: %s',
    async (purity) => {
      const screen = await renderScreen();

      await fill(screen, 'Name', 'Gold bar');
      await fill(screen, 'Purity', purity);
      await fill(screen, 'Quantity', '31.1');
      await fill(screen, 'Total cost', '80000');
      await fireEvent.press(screen.getByText('Save'));

      expect(screen.getByText('Enter a purity between 0 and 1.')).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();
    },
  );

  // Writes the exact normalized purity the user typed, never the pre-fill
  // default — the value here is deliberately NOT '0.9999' so a substitution
  // bug can't hide behind a coincidental match.
  it('creates a metal holding with the exact typed purity, not the pre-filled default', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Purity', '0.750');
    await fill(screen, 'Quantity', '31.1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ purity: '0.750' }),
      }),
    );
  });

  it('edits a metal holding without Quantity/Total cost fields, preserving its stored lots', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Gold bar',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'oz',
        purity: '0.9999',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
      },
    });

    expect(screen.queryByLabelText('Quantity')).toBeNull();
    expect(screen.queryByLabelText('Total cost')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: {
          metal: 'XAU',
          form: 'bar',
          unit: 'oz',
          purity: '0.9999',
          lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
        },
      }),
      expect.any(Number),
    );
    expect(updateDeltaMock.mock.calls[0][1]).not.toHaveProperty('balance');
  });

  // Writes the exact normalized purity the user typed, never the value the
  // holding was hydrated with — the value here is deliberately different
  // from the hydrated '0.9999' so a substitution bug can't hide behind a
  // coincidental match.
  it('edits a metal holding writing the exact typed purity, not the hydrated one', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Gold bar',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'oz',
        purity: '0.9999',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
      },
    });

    await fill(screen, 'Purity', '0.750');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: expect.objectContaining({ purity: '0.750' }),
      }),
      expect.any(Number),
    );
  });

  // Purity stays user-editable in edit mode (unlike
  // Quantity/Total cost, which are create-only), so it must validate there
  // too.
  it('blocks save for a garbled purity in EDIT mode too, leaving the stored MetalMeta untouched', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Gold bar',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'oz',
        purity: '0.9999',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
      },
    });

    await fill(screen, 'Purity', '999,9');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a purity between 0 and 1.')).toBeTruthy();
    expect(updateDeltaMock).not.toHaveBeenCalled();
  });

  it('edits a metal holding onto a different metal element, preserving its stored lots', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Gold bar',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        metal: 'XAU',
        form: 'bar',
        unit: 'oz',
        purity: '0.9999',
        lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
      },
    });

    expect(screen.getByTestId('holding-type-field')).toHaveTextContent('Gold');

    await openHoldingTypeSheet(screen);

    expect(typeOptionIds(screen)).toEqual(metalOptionIds);

    await selectHoldingTypeOption(screen, 'XAG');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          metal: 'XAG',
          lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 }],
        }),
      }),
      expect.any(Number),
    );
  });
});

describe('HoldingFormScreen loan', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    navigation.goBack.mockClear();
    updateDeltaMock.mockClear();
    updateLoanMock.mockClear();
    mockAccountKind = 'debt';
    mockAccountInstitution = null;
  });

  const fillLoanFields = async (screen: Screen): Promise<void> => {
    await fill(screen, 'Name', 'Car loan');
    await fill(screen, 'Principal', '500000');
    await pickDate(screen, 'Start date', 2026, 1, 1);
  };

  it('creates an annuity loan with a full LoanMeta and no firstPricePoint', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '24');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'loan',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 50_000_000,
          startDate: localDay(2026, 1, 1),
          schedule: 'annuity',
          annualRatePct: 12,
          termMonths: 24,
        },
      }),
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('firstPricePoint');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('creates a loan with paymentHoldingId/lenderName/lenderIban, picked from the "Paid from" field', async () => {
    mockAllHoldings = [
      {
        id: 'h-payer',
        accountId: 'acc-2',
        name: 'Everyday card',
        type: 'card',
        currency: 'UAH',
        closedAt: null,
        icon: null,
        color: null,
      },
    ];
    mockAllAccounts = [{ id: 'acc-2', name: 'Monobank' }];
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '24');
    await fireEvent.press(screen.getByTestId('loan-payment-holding-field'));
    await fireEvent.press(screen.getByText('Everyday card'));
    await fill(screen, 'Lender name', 'PrivatBank');
    await fill(screen, 'Lender IBAN', 'UA123456789012345678901234567');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          paymentHoldingId: 'h-payer',
          lenderName: 'PrivatBank',
          lenderIban: 'UA123456789012345678901234567',
        }),
      }),
    );
  });

  it('excludes a DIFFERENT-currency holding from the "Paid from" options', async () => {
    mockAllHoldings = [
      {
        id: 'h-usd',
        accountId: 'acc-2',
        name: 'USD card',
        type: 'card',
        currency: 'USD',
        closedAt: null,
        icon: null,
        color: null,
      },
    ];
    mockAllAccounts = [{ id: 'acc-2', name: 'Monobank' }];
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fireEvent.press(screen.getByTestId('loan-payment-holding-field'));

    expect(screen.queryByText('USD card')).toBeNull();
  });

  // A filter never hides an ACTIVE selection —
  // `buildLoanOptions` (the transaction form's own loan-payment field)
  // already unions a closed/mismatched selection back in; "Paid from" must
  // do the same, or an edited loan's own payer silently reads as "None".
  it('keeps a closed "Paid from" holding visible (not "None") in edit mode', async () => {
    mockAllHoldings = [
      {
        id: 'h-payer',
        accountId: 'acc-2',
        name: 'Everyday card',
        type: 'card',
        currency: 'UAH',
        closedAt: 1_700_000_000_000,
        icon: null,
        color: null,
      },
    ];
    mockAllAccounts = [{ id: 'acc-2', name: 'Monobank' }];
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: localDay(2026, 1, 1),
        schedule: 'annuity',
        annualRatePct: 12,
        termMonths: 24,
        paymentHoldingId: 'h-payer',
      },
    });

    expect(screen.getByText('Everyday card')).toBeTruthy();
  });

  it('keeps a different-currency "Paid from" holding visible (not "None") in edit mode', async () => {
    mockAllHoldings = [
      {
        id: 'h-payer',
        accountId: 'acc-2',
        name: 'USD card',
        type: 'card',
        currency: 'USD',
        closedAt: null,
        icon: null,
        color: null,
      },
    ];
    mockAllAccounts = [{ id: 'acc-2', name: 'Monobank' }];
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: localDay(2026, 1, 1),
        schedule: 'annuity',
        annualRatePct: 12,
        termMonths: 24,
        paymentHoldingId: 'h-payer',
      },
    });

    expect(screen.getByText('USD card')).toBeTruthy();
  });

  it('creates a car-loan-kind loan under the tapped kind option', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('loan-kind-field'));
    await fireEvent.press(screen.getByTestId('loan-kind-field-option-car_loan'));
    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '9');
    await fill(screen, 'Term (months)', '36');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: 'car_loan' }) }),
    );
  });

  it('creates a "none" (informal) loan with a first manual price point equal to the principal at the start date', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fireEvent.press(screen.getByText('No schedule'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'loan',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 50_000_000,
          startDate: localDay(2026, 1, 1),
          schedule: 'none',
        },
        firstPricePoint: { day: dayKeyOf(localDay(2026, 1, 1)), price: '500000.00' },
      }),
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('writes no balance TextField for a loan holding (it is ledgerless)', async () => {
    const screen = await renderScreen();

    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('hides the rate and term fields, and does not block save on them, for a "none" schedule', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('No schedule'));

    expect(screen.queryByLabelText('Annual rate %')).toBeNull();
    expect(screen.queryByLabelText('Term (months)')).toBeNull();

    await fillLoanFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalled();
  });

  it('blocks save and shows the principal error for a blank principal, only after Save is pressed', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Car loan');
    expect(screen.queryByText('Principal must be greater than 0.')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Principal must be greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the start-date reason directly on that field, once the principal is set but no date is picked', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Car loan');
    await fill(screen, 'Principal', '500000');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('No start date selected.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('shows the principal and start-date errors together at the same Save press, each clearing only its own field', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Car loan');
    await fireEvent.press(screen.getByText('No schedule'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Principal must be greater than 0.')).toBeTruthy();
    expect(screen.getByText('No start date selected.')).toBeTruthy();

    await fill(screen, 'Principal', '500000');

    expect(screen.queryByText('Principal must be greater than 0.')).toBeNull();
    expect(screen.getByText('No start date selected.')).toBeTruthy();

    await pickDate(screen, 'Start date', 2026, 1, 1);

    expect(screen.queryByText('No start date selected.')).toBeNull();
  });

  // A degenerate term must not silently pass.
  it('shows the term reason for a zero term on an annuity loan', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '0');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('names the maximum once the loan term exceeds MAX_TERM_MONTHS', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', String(MAX_TERM_MONTHS + 1));
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText(`Enter a whole number of months from 1 to ${MAX_TERM_MONTHS}.`),
    ).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('renders a visible text label above every loan field', async () => {
    const screen = await renderScreen();

    expect(screen.getByText('Loan kind')).toBeTruthy();
    expect(screen.getByLabelText('Principal')).toBeTruthy();
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByText('Schedule')).toBeTruthy();
    expect(screen.getByLabelText('Annual rate %')).toBeTruthy();
    expect(screen.getByLabelText('Term (months)')).toBeTruthy();
  });

  it('edits a loan holding, saving every field as editable metadata (not create-only)', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: localDay(2026, 1, 1),
        schedule: 'annuity',
        annualRatePct: 12,
        termMonths: 24,
      },
    });

    expect(screen.getByLabelText('Principal').props.value).toBe('500 000');
    expect(screen.getByLabelText('Annual rate %').props.value).toBe('12');
    expect(screen.getByLabelText('Term (months)').props.value).toBe('24');

    await fill(screen, 'Principal', '600000');
    await fireEvent.press(screen.getByText('Save'));

    // Staying `annuity` end to end (none of the schedule-change cases below
    // apply): a scheduled loan's principal edit takes effect through the
    // metadata itself at read time, so no price-point write is needed —
    // `updateLoan` still runs (in place of `updateWithBalanceDelta`), with a
    // 'none' op.
    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: {
          kind: 'car_loan',
          principalMinorUnits: 60_000_000,
          startDate: localDay(2026, 1, 1),
          schedule: 'annuity',
          annualRatePct: 12,
          termMonths: 24,
        },
      }),
      { kind: 'none' },
      // The principal changed, so this edit clears the loan's own auto
      // links (they may no longer match the new schedule).
      true,
    );
    expect(updateLoanMock.mock.calls[0][1]).not.toHaveProperty('balanceMinorUnits');
    expect(updateDeltaMock).not.toHaveBeenCalled();
  });

  it('edits a "none" loan, keeping its schedule and hiding the rate/term fields', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'IOU',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'personal',
        principalMinorUnits: 10_000_00,
        startDate: localDay(2026, 1, 1),
        schedule: 'none',
      },
    });

    expect(screen.queryByLabelText('Annual rate %')).toBeNull();
    expect(screen.queryByLabelText('Term (months)')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    // (c)'s catch-all, with nothing actually changed: principal/startDate are
    // untouched, so `buildLoanPricePointOp` writes no price point.
    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: {
          kind: 'personal',
          principalMinorUnits: 10_000_00,
          startDate: localDay(2026, 1, 1),
          schedule: 'none',
        },
      }),
      { kind: 'none' },
      // Nothing that matters to the matcher changed.
      false,
    );
  });

  // annuity/differentiated -> 'none' preserves the OLD schedule's
  // current outstanding as a manual point dated today, so the debt never
  // silently reads as 0 the instant the schedule is cleared. Seeds a
  // correction dated today so the anchored outstanding is an exact, known
  // value — proving the reactive `book` is actually wired through, not just
  // that some in-range number came out.
  it('(a) switching an annuity loan to "none" upserts today\'s outstanding as a manual point', async () => {
    const today = dayKeyOf(Date.now());
    mockPricePoints = [
      {
        instrument: 'holding:h1',
        day: today,
        price: '300000.00',
        currency: 'UAH',
        source: 'manual',
      },
    ];
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: localDay(2026, 1, 1),
        schedule: 'annuity',
        annualRatePct: 0,
        termMonths: 10,
      },
    });

    await fireEvent.press(screen.getByText('No schedule'));
    await fireEvent.press(screen.getByText('Save'));

    // The seeded correction anchors the outstanding: no installment can fall
    // strictly after `today` and on or before `today`, so the preserved
    // value is exactly the correction's own price.
    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ metadata: expect.objectContaining({ schedule: 'none' }) }),
      { kind: 'upsert', day: today, price: '300000.00', currency: 'UAH' },
      // The schedule changed (annuity -> none).
      true,
    );
  });

  // The case (a) conversion above, on a loan whose start date is still in
  // the FUTURE, must never write today's (0) outstanding as a permanent
  // point — `loanOutstandingMinorAt` reads 0 for any instant before
  // `startDate`, so that 0 would outlive the start date once it arrives and
  // the debt would silently read as 0 forever. It must write the principal
  // at the start day instead, mirroring the create-mode first point.
  it('(a) switching a future-start annuity loan to "none" writes the principal at the start day, not a 0 today', async () => {
    const futureStart = localDay(2099, 1, 1);
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: futureStart,
        schedule: 'annuity',
        annualRatePct: 12,
        termMonths: 10,
      },
    });

    await fireEvent.press(screen.getByText('No schedule'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ metadata: expect.objectContaining({ schedule: 'none' }) }),
      {
        kind: 'upsert',
        day: dayKeyOf(futureStart),
        price: '500000.00',
        currency: 'UAH',
      },
      // The schedule changed (annuity -> none).
      true,
    );
  });

  // A 'none' loan's principal/start-date edit moves the start-day
  // point — delete the old day, insert the new principal at the new day.
  // Later correction points stay untouched.
  it('(b) editing a "none" loan\'s principal moves its start-day point', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'IOU',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'personal',
        principalMinorUnits: 10_000_00,
        startDate: localDay(2026, 1, 1),
        schedule: 'none',
      },
    });

    await fill(screen, 'Principal', '15000');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: expect.objectContaining({ principalMinorUnits: 15_000_00 }),
      }),
      {
        kind: 'move',
        oldDay: dayKeyOf(localDay(2026, 1, 1)),
        newDay: dayKeyOf(localDay(2026, 1, 1)),
        price: '15000.00',
        currency: 'UAH',
      },
      // A 'none' schedule has no installments at all (`loanInstallments`
      // returns `[]` regardless of principal), so it never receives an AUTO
      // link in the first place — nothing for this edit to invalidate.
      false,
    );
  });

  // 'none' -> a schedule leaves the manual series untouched — a
  // correction point is still valid for a scheduled loan.
  it('(c) switching a "none" loan to annuity keeps the manual series untouched', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'IOU',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'personal',
        principalMinorUnits: 10_000_00,
        startDate: localDay(2026, 1, 1),
        schedule: 'none',
      },
    });

    await fireEvent.press(screen.getByText('Annuity'));
    await fill(screen, 'Annual rate %', '10');
    await fill(screen, 'Term (months)', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ metadata: expect.objectContaining({ schedule: 'annuity' }) }),
      { kind: 'none' },
      // The schedule changed (none -> annuity).
      true,
    );
  });

  // The matcher backfills from the loan's own start date, so both a fresh
  // loan and an edited one (principal/schedule/paymentHoldingId/lenderName/
  // lenderIban can all change) need a fresh run — unlike `refreshMarketData`
  // just above, which only ever fires on create (type/currency are
  // immutable in edit mode, so it has nothing new to react to there).
  it('runs the loan auto-link matcher after a loan CREATE', async () => {
    mockRunLoanAutoLink.mockClear();
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate %', '12');
    await fill(screen, 'Term (months)', '24');
    await fireEvent.press(screen.getByText('Save'));

    expect(mockRunLoanAutoLink).toHaveBeenCalled();
  });

  it('runs the loan auto-link matcher after a loan EDIT too', async () => {
    mockRunLoanAutoLink.mockClear();
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'car_loan',
        principalMinorUnits: 50_000_000,
        startDate: localDay(2026, 1, 1),
        schedule: 'annuity',
        annualRatePct: 12,
        termMonths: 24,
      },
    });

    await fireEvent.press(screen.getByText('Save'));

    expect(mockRunLoanAutoLink).toHaveBeenCalled();
  });
});

describe('HoldingFormScreen icon', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    updateMock.mockClear();
    updateDeltaMock.mockClear();
  });

  it('sets the picked icon on the new holding using the returned id', async () => {
    // A cash holding is valid with just a name (a bank create defaults to a term
    // deposit, which needs contributions), so it is the simplest create path.
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText('Choose icon banknote'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalled();
    expect(setIconMock).toHaveBeenCalledWith('new-holding-id', 'banknote');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('hands a create-mode opening balance to create, the one path that seeds its ledger row', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fill(screen, 'Balance', '500');
    await fireEvent.press(screen.getByText('Save'));

    // The form writes the opening balance through `create` and nothing else:
    // `create` seeds the matching `manual` opening row inside its own
    // transaction (see holdings.repo.ts, and its tests for the row's shape), so
    // a new holding's balance is explained by its ledger from the first render.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        currency: 'UAH',
        openingBalance: Money.of('UAH', 500_00),
      }),
    );
    expect(updateDeltaMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not set an icon when none is picked', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalled();
    expect(setIconMock).not.toHaveBeenCalled();
  });

  it('creates one holding for a double-tapped Save', async () => {
    // A cash holding is valid with just a name (a bank create defaults to a term
    // deposit, which needs contributions), so it is the simplest create path.
    mockAccountKind = 'cash';

    // Hold the write open (never auto-resolving) so the first press's `await`
    // genuinely has not settled when the second press lands — firing two real
    // `fireEvent.press` calls back to back without awaiting between them trips
    // React's "overlapping act() calls" guard (each is independently wrapped
    // in its own act()), so the two presses are awaited sequentially instead;
    // the guard is still exercised because the write only resolves when this
    // test says so. `mockImplementationOnce` (rather than `mockImplementation`)
    // consumes itself on this one call and falls back to the module's default
    // `mockResolvedValue('new-holding-id')` afterwards, so it does not leak
    // into the next test.
    let resolveWrite: (id: string) => void = () => {};
    createMock.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');

    const save = screen.getByText('Save');

    await fireEvent.press(save);
    await fireEvent.press(save);

    expect(createMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite('new-holding-id');
    });
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('HoldingFormScreen create-mode hidden opening balance', () => {
  beforeEach(() => {
    // A non-synced bank offers Card alongside term_deposit/bond (test above),
    // and `type` starts at `card` (its own doc comment), so these tests can
    // type a balance on the visible Card field before switching type without
    // an extra type-select step.
    mockAccountKind = 'bank';
    mockAccountInstitution = null;
  });

  it('writes no opening balance for a term deposit created after typing a balance on Card', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Balance', '100');
    await fillTermDepositFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock.mock.calls[0][0]).not.toHaveProperty('openingBalance');
  });

  it('writes no opening balance for a bond created after typing a balance on Card', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Balance', '100');
    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock.mock.calls[0][0]).not.toHaveProperty('openingBalance');
  });

  it('still writes the typed balance for a card-only create', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My card');
    await fill(screen, 'Balance', '100');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ openingBalance: Money.of('UAH', 100_00) }),
    );
  });
});

describe('HoldingFormScreen icon follows type until dirty', () => {
  it("shows the default type's icon before any pick (bank -> term_deposit -> calendar)", async () => {
    // A bank create defaults to a term deposit, so the not-dirty icon follows its
    // default glyph (calendar).
    const screen = await renderScreen();

    expect(screen.getByLabelText('Icon calendar')).toBeTruthy();
  });

  it('re-derives the icon to the newly selected type default while not dirty', async () => {
    const screen = await renderScreen();

    // term_deposit default is calendar; switching to bond swaps the shown default
    // to the bond glyph (receipt), because the icon has not been manually picked
    // (not dirty).
    await selectHoldingType(screen, 'bond');

    expect(screen.getByLabelText('Icon receipt')).toBeTruthy();
  });

  it('keeps a manually picked icon when the type changes afterwards (dirty)', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByLabelText('Change Icon'));
    // Pick from the Kiko Entities pool the holding form now offers.
    await fireEvent.press(screen.getByLabelText('Choose icon giftcard'));

    expect(screen.getByLabelText('Icon giftcard')).toBeTruthy();

    // Once picked, the icon is dirty: switching type no longer moves it off the
    // user's choice.
    await selectHoldingType(screen, 'bond');

    expect(screen.getByLabelText('Icon giftcard')).toBeTruthy();
    expect(screen.queryByLabelText('Icon receipt')).toBeNull();
  });
});

describe('HoldingFormScreen type options are constrained by the account kind', () => {
  it('offers only the manually-creatable types (term_deposit, bond) on a SYNCED bank, excluding sync-only card and jar', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = 'monobank';

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    // Monobank owns card + jar (its sync creates them), so the manual create form
    // drops both; a synced bank create offers only term_deposit and bond. Cash
    // and crypto_asset are forbidden under a bank regardless.
    expect(screen.getByTestId('holding-type-field-option-term_deposit')).toBeTruthy();
    expect(screen.getByTestId('holding-type-field-option-bond')).toBeTruthy();
    expect(screen.queryByTestId('holding-type-field-option-card')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-jar')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-cash')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-crypto_asset')).toBeNull();
  });

  it('offers Card on a NON-synced (statement-import-only) bank — no sync owns it there — while still excluding Jar', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = null;

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    // No Monobank connection means no sync creates a card for this account, so
    // the user must be able to create one manually. Jar stays sync-only always
    // (a Monobank-API-specific concept with no import equivalent).
    expect(screen.getByTestId('holding-type-field-option-card')).toBeTruthy();
    expect(screen.getByTestId('holding-type-field-option-term_deposit')).toBeTruthy();
    expect(screen.getByTestId('holding-type-field-option-bond')).toBeTruthy();
    expect(screen.queryByTestId('holding-type-field-option-jar')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-cash')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-crypto_asset')).toBeNull();
  });

  it('offers only the crypto_asset holding type on a crypto account', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    expect(screen.getByTestId('holding-type-field-option-crypto_asset')).toBeTruthy();
    expect(screen.queryByTestId('holding-type-field-option-card')).toBeNull();
    expect(screen.queryByTestId('holding-type-field-option-term_deposit')).toBeNull();
  });

  it('snaps an out-of-range default type into the account kind allowed set', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();

    // The default type is `card`, which a crypto account forbids, so the form
    // resets to the first allowed type (crypto_asset) — proven by the shown
    // default icon following to the crypto_asset glyph.
    expect(screen.getByLabelText('Icon bitcoinsign.circle')).toBeTruthy();
  });

  it('offers only the four metals on a metals account', async () => {
    mockAccountKind = 'metals';
    mockAccountInstitution = null;

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    expect(typeOptionIds(screen)).toEqual(metalOptionIds);
  });

  it('drops metal from a bank account with no bankId (the metal allow-list)', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = null;
    mockAccountBankId = null;

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    expect(screen.queryByTestId('holding-type-field-option-metal')).toBeNull();
  });

  it('drops metal from a bank account whose bankId is not allow-listed (monobank)', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = 'monobank';
    mockAccountBankId = 'monobank';

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    expect(screen.queryByTestId('holding-type-field-option-metal')).toBeNull();
  });

  it('lists the bank types, then the four metals, on a bank account whose bankId is allow-listed (privatbank)', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = 'monobank';
    mockAccountBankId = 'privatbank';

    const screen = await renderScreen();
    await openHoldingTypeSheet(screen);

    expect(typeOptionIds(screen)).toEqual([
      'holding-type-field-option-term_deposit',
      'holding-type-field-option-bond',
      ...metalOptionIds,
    ]);
  });

  it('creates a silver holding when Silver is picked on an allow-listed bank account', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = null;
    mockAccountBankId = 'privatbank';

    const screen = await renderScreen();
    await selectHoldingType(screen, 'XAG');
    await fill(screen, 'Name', 'Silver bar');
    await fill(screen, 'Quantity', '1');
    await fill(screen, 'Total cost', '100');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'metal',
        metadata: expect.objectContaining({ metal: 'XAG' }),
      }),
    );
  });

  it('keeps the disabled generic Type field when editing a term deposit on an allow-listed bank account', async () => {
    mockAccountKind = 'bank';
    mockAccountInstitution = null;
    mockAccountBankId = 'privatbank';

    const screen = await renderEdit(depositHolding);

    expect(screen.getByTestId('holding-type-field')).toHaveTextContent('Deposit');
    expect(screen.getByTestId('holding-type-field').props.accessibilityState.disabled).toBe(true);
  });
});

describe('HoldingFormScreen color follows type until dirty', () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it("selects the default type's color before any pick (bank -> term_deposit -> blue)", async () => {
    // A bank create defaults to a term deposit, whose default swatch is blue.
    const screen = await renderScreen();

    expect(screen.getByLabelText('Color blue').props.accessibilityState.selected).toBe(true);
  });

  it('re-derives the color to the newly selected type default while not dirty', async () => {
    const screen = await renderScreen();

    // term_deposit default is blue; switching to bond swaps the selected default
    // swatch to green, because the color has not been manually picked (not dirty).
    await selectHoldingType(screen, 'bond');

    expect(screen.getByLabelText('Color green').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Color blue').props.accessibilityState.selected).toBe(false);
  });

  it('keeps a manually picked color when the type changes afterwards (dirty)', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByLabelText('Color violet'));

    expect(screen.getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    // Once picked, the color is dirty: switching type no longer moves it off the
    // user's choice onto the bond default (green).
    await selectHoldingType(screen, 'bond');

    expect(screen.getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Color green').props.accessibilityState.selected).toBe(false);
  });

  it('persists the manually picked color on create', async () => {
    // A cash holding is valid with just a name (the simplest create path).
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByLabelText('Color violet'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock.mock.calls[0][0].color).toBe(entityColors.violet);
  });

  it('persists a null color on create when the user never picks one', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock.mock.calls[0][0].color).toBeNull();
  });
});

const cardHolding = {
  id: 'h-1',
  name: 'Everyday card',
  type: 'card',
  currency: 'UAH',
  balanceMinorUnits: 250_00,
  icon: 'banknote',
  color: entityColors.violet,
};

// A synced (Monobank) card: its metadata carries the monobankId that marks the
// balance as sync-owned, so editing it must not write a user balance back.
const syncedCardHolding = {
  id: 'h-2',
  name: 'Monobank card',
  type: 'card',
  currency: 'UAH',
  balanceMinorUnits: 500_00,
  icon: null,
  color: null,
  metadata: { monobankId: 'card-123' },
};

const depositHolding = {
  id: 'h-1',
  name: 'My deposit',
  type: 'term_deposit',
  currency: 'UAH',
  balanceMinorUnits: 0,
  icon: null,
  color: null,
  metadata: {
    contributions: [{ amountMinorUnits: 100_000, date: localDay(2026, 1, 1) }],
    annualRatePct: 12,
    termMonths: 24,
    recapitalization: true,
    compounding: 'monthly',
  },
};

const bondHolding = {
  id: 'h-1',
  name: 'Gov bond',
  type: 'bond',
  currency: 'UAH',
  balanceMinorUnits: 0,
  icon: null,
  color: null,
  metadata: {
    quantity: 10,
    faceValueMinorUnits: 100_000,
    couponPct: 9,
    purchasePriceMinorUnits: 950_000,
    purchaseDate: localDay(2026, 1, 1),
    maturityDate: localDay(2028, 1, 1),
    bondKind: 'corporate',
    couponFrequency: 'quarterly',
  },
};

describe('HoldingFormScreen edit mode', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
    updateMock.mockClear();
    updateDeltaMock.mockClear();
  });

  it('sets the header title to "Edit Holding"', async () => {
    await renderEdit(cardHolding);

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Holding' });
  });

  it('seeds the name, icon, and color from the existing holding', async () => {
    const { getByDisplayValue, getByLabelText } = await renderEdit(cardHolding);

    expect(getByDisplayValue('Everyday card')).toBeTruthy();
    expect(getByLabelText('Icon banknote')).toBeTruthy();
    expect(getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
  });

  it('seeds the balance for a simple type as a grouped major string', async () => {
    const { getByDisplayValue } = await renderEdit(cardHolding);

    // 25000 minor UAH -> "250" major, shown in the Balance field.
    expect(getByDisplayValue('250')).toBeTruthy();
  });

  it('hydrates a dust BTC balance at full scale, not exponential notation', async () => {
    // Below 100 satoshis, `String(toMajor(...))` emits exponential notation
    // ("5e-7"), which the grouping formatter used to strip down to its digits
    // ("57") — a 50-satoshi holding rendered, and would save, as 57 BTC.
    const { getByLabelText } = await renderEdit({
      id: 'h-btc',
      name: 'Wallet',
      type: 'crypto_asset',
      currency: 'BTC',
      balanceMinorUnits: 50,
      icon: null,
      color: null,
    });

    expect(getByLabelText('Balance').props.value).toBe('0.0000005');
  });

  it('shows type and currency read-only (disabled) so neither can change', async () => {
    const { getByTestId, queryByTestId } = await renderEdit(cardHolding);

    // A synced card's type is dropped from the CREATE options, but edit mode uses
    // the full set — so the type field still shows Card (read-only) rather than
    // crashing on a type that is no longer manually creatable.
    expect(getByTestId('holding-type-field').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByTestId('holding-type-field'));
    expect(queryByTestId('holding-type-field-option-bond')).toBeNull();
    // The currency field is disabled in edit mode: its trigger reports the
    // disabled state and pressing it opens no sheet, so the currency is fixed.
    expect(getByTestId('holding-currency-field').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(getByTestId('holding-currency-field'));
    expect(queryByTestId('currency-option-USD')).toBeNull();
  });

  it('renders an existing synced jar holding read-only, though jar is not manually creatable', async () => {
    const { getByTestId } = await renderEdit({
      id: 'h-9',
      name: 'Coffee jar',
      type: 'jar',
      currency: 'UAH',
      balanceMinorUnits: 5_000,
      icon: null,
      color: null,
    });

    // Same as the card case: jar is sync-only (excluded from create), but edit
    // mode's full set still shows the type field (Jar), read-only, rather than
    // crashing.
    expect(getByTestId('holding-type-field').props.accessibilityState.disabled).toBe(true);
  });

  it('saves a simple type through update with the edited name, color, and balance', async () => {
    const screen = await renderEdit(cardHolding);

    await fill(screen, 'Name', 'Renamed card');
    await fill(screen, 'Balance', '300');
    await fireEvent.press(screen.getByLabelText('Color teal'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h-1',
      { name: 'Renamed card', color: entityColors.teal, balance: Money.of('UAH', 300_00) },
      expect.any(Number),
    );
    expect(setIconMock).toHaveBeenCalledWith('h-1', 'banknote');
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('routes a balance edit through the ledger-writing update, never the bare one', async () => {
    const screen = await renderEdit(cardHolding);

    // 250 -> 500 UAH. The repo turns the new absolute balance into a +250.00
    // manual transaction against the STORED balance, so the holding's history
    // stays derivable from its ledger (kiko-domain) and the past net-worth
    // series does not shift under the edit.
    await fill(screen, 'Balance', '500');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h-1',
      expect.objectContaining({ balance: Money.of('UAH', 500_00) }),
      expect.any(Number),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('persists a cleared custom icon as null when saving in edit mode', async () => {
    const screen = await renderEdit(cardHolding);

    // The card starts with a custom icon; clearing it and saving must persist
    // the removal (an explicit null), not silently keep the old glyph.
    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByText('Remove'));
    await fireEvent.press(screen.getByText('Save'));

    expect(setIconMock).toHaveBeenCalledWith('h-1', null);
  });

  it('hides the Balance input when editing a synced holding', async () => {
    mockAccountInstitution = 'monobank';
    const screen = await renderEdit(syncedCardHolding);

    // A synced holding's balance is owned by the sync, so the manual balance
    // field is not offered in edit mode.
    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('offers the Balance input again once the account is disconnected', async () => {
    // The disconnected account keeps the holding's `monobankId` (so a reconnect
    // re-adopts the row), but nothing syncs its balance anymore — the user owns
    // it again, so the field comes back.
    mockAccountInstitution = null;
    const screen = await renderEdit(syncedCardHolding);

    expect(screen.queryByLabelText('Balance')).not.toBeNull();
  });

  it('does not write a balance when editing a synced holding', async () => {
    mockAccountInstitution = 'monobank';
    const screen = await renderEdit(syncedCardHolding);

    await fill(screen, 'Name', 'Renamed monobank');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.name).toBe('Renamed monobank');
    // The synced balance must stay untouched until the next sync.
    expect(patch.balance).toBeUndefined();
  });

  it('seeds a term deposit and saves its edited metadata through update', async () => {
    const screen = await renderEdit(depositHolding);

    // The stored contribution/rate/term seed the fields.
    expect(screen.getByDisplayValue('1 000')).toBeTruthy();
    expect(screen.getByDisplayValue('12')).toBeTruthy();
    expect(screen.getByDisplayValue('24')).toBeTruthy();

    await fill(screen, 'Annual rate %', '15');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.name).toBe('My deposit');
    expect(patch.metadata.annualRatePct).toBe(15);
    expect(patch.metadata.termMonths).toBe(24);
    expect(patch.metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
    ]);
    // A deposit's value derives from metadata, so no balance is written.
    expect(patch.balance).toBeUndefined();
  });

  it('seeds a bond and saves its edited metadata through update', async () => {
    const screen = await renderEdit(bondHolding);

    // Stored bond fields seed the inputs (quantity, coupon %, corporate kind).
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    expect(screen.getByDisplayValue('9')).toBeTruthy();
    expect(screen.getByText('Corporate').parent?.props.accessibilityState.selected).toBe(true);

    await fill(screen, 'Coupon %', '11');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.metadata.couponPct).toBe(11);
    expect(patch.metadata.quantity).toBe(10);
    expect(patch.metadata.bondKind).toBe('corporate');
    expect(patch.balance).toBeUndefined();
  });

  it('resolves a stored empty-string color to a real swatch, not blank', async () => {
    const { getByLabelText } = await renderEdit({ ...cardHolding, color: '' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
  });

  it('disables Remove on a saved contribution while keeping it enabled on a newly-added one', async () => {
    const screen = await renderEdit(depositHolding);

    // The one stored contribution hydrates as row 1 (saved). Add a second row so
    // both Remove controls render (the length > 1 guard) — row 2 is unsaved.
    await fireEvent.press(screen.getByText('Add contribution'));

    const savedRemove = screen.getByLabelText('Remove contribution 1');
    const newRemove = screen.getByLabelText('Remove contribution 2');

    // A persisted contribution is part of the deposit's history: its Remove is
    // disabled, and pressing it is a no-op (the disabled Pressable never fires).
    expect(savedRemove.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(savedRemove);
    expect(screen.getByLabelText('Contribution 1 amount')).toBeTruthy();
    expect(screen.getByLabelText('Contribution 2 amount')).toBeTruthy();

    // The newly-added row is removable: its Remove is enabled and drops the row.
    expect(newRemove.props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(newRemove);
    expect(screen.queryByLabelText('Contribution 2 amount')).toBeNull();
  });
});

describe('HoldingFormScreen — localization', () => {
  beforeEach(() => {
    mockAccountKind = 'cash';
    mockEditHoldings = [];
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the type/currency/balance field chrome from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByLabelText, getByText, queryByText } = await renderScreen();

    expect(getByLabelText('Назва')).toBeTruthy();
    expect(getByText('Тип')).toBeTruthy();
    expect(getByText('Валюта')).toBeTruthy();
    expect(getByLabelText('Баланс')).toBeTruthy();
    expect(getByText('Готівка')).toBeTruthy();
    expect(getByText('Зберегти')).toBeTruthy();
    expect(queryByText('Balance')).toBeNull();
  });

  it('renders the bond field group from the Ukrainian catalog', async () => {
    mockAccountKind = 'bank';
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByText, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('holding-type-field'));
    await fireEvent.press(getByTestId('holding-type-field-option-bond'));
    await fireEvent.press(getByText('Вручну'));

    // `forms.holding.details` is the shared heading of the property, metal,
    // bond, and loan blocks, so it reads a generic "Details", not a
    // bond-specific one.
    expect(getByText('Деталі')).toBeTruthy();
    expect(getByText('Кількість')).toBeTruthy();
    expect(getByText('Номінальна вартість')).toBeTruthy();
    expect(getByText('Купон %')).toBeTruthy();
    expect(getByText('Дата придбання')).toBeTruthy();
    expect(getByText('Дата погашення')).toBeTruthy();
    expect(getByText('Тип облігації')).toBeTruthy();
    expect(getByText('Державна')).toBeTruthy();
  });
});

// kiko-architecture: no request or query for data the user does not have —
// usePriceBook's price_points read is disabled while the active type (the
// row being edited, or the currently selected type in create mode) never
// reads it.
describe('HoldingFormScreen — the price_points gate', () => {
  it('disables the price_points read for the create-mode default type (card is not priced)', async () => {
    await renderScreen();

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(false);
  });

  it('enables the price_points read once the create-mode default type snaps to metal', async () => {
    // A metals-kind account offers ONLY metal, so the create-mode default-type
    // effect snaps straight to it (a LATER render than the initial 'card'
    // default) — no bank to gate the allow-list on.
    mockAccountKind = 'metals';
    await renderScreen();

    const priceCalls = mockUseLiveQuery.mock.calls.filter((call) => call[1][0] === 'price_points');
    expect(priceCalls.at(-1)?.[2]).toBe(true);
  });

  it('enables the price_points read for a metal holding in edit mode', async () => {
    await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Gold bar',
      type: 'metal',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: { metal: 'XAU', form: 'bar', unit: 'g', purity: '0.9999', lots: [] },
    });

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });

  it('enables the price_points read for a loan holding in edit mode (not priced, but reads the same series)', async () => {
    await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        principalMinorUnits: 100_000_00,
        startDate: Date.now(),
        annualRatePct: '10',
        termMonths: 12,
        schedule: 'none',
      },
    });

    const priceCall = mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'price_points');
    expect(priceCall?.[2]).toBe(true);
  });
});

// kiko-architecture: the FIRST metal/foreign-currency/crypto holding needs
// its price/rate visible without an app restart — a create triggers the
// same gated refresh app-open runs; an edit (type/currency are immutable
// once created) never needs to.
describe('HoldingFormScreen — the first-add refresh trigger', () => {
  beforeEach(() => {
    mockRefreshMarketData.mockClear();
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockClear();
  });

  it('triggers the gated rate/metal refresh after a successful create, unthrottled', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: false, metals: true });
  });

  it('navigates back immediately, without waiting for the refresh to settle', async () => {
    // The refresh is a background nicety, not a save precondition — Save must
    // not sit on the network before returning to the account. A still-pending
    // refresh promise proves navigation already fired without it.
    mockAccountKind = 'cash';
    let resolveRefresh: () => void = () => {};
    mockRefreshMarketData.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve(right(undefined));
        }),
    );

    const screen = await renderScreen();
    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(navigation.goBack).toHaveBeenCalled();

    resolveRefresh();
  });

  it('does not trigger the refresh after an edit (type/currency cannot change)', async () => {
    const screen = await renderEdit({
      id: 'h1',
      accountId: 'acc-1',
      name: 'Everyday card',
      type: 'card',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
    });

    await fill(screen, 'Name', 'Renamed card');
    await fireEvent.press(screen.getByText('Save'));

    expect(mockRefreshMarketData).not.toHaveBeenCalled();
    expect(mockRunLoanAutoLink).not.toHaveBeenCalled();
  });

  // P-NOWORK: a non-loan create/edit never runs the loan auto-link matcher
  // at all — see `HoldingFormScreen loan`'s own describe block for the
  // matching POSITIVE loan create/edit cases.
  it('does not trigger the loan auto-link matcher for a non-loan create', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(mockRunLoanAutoLink).not.toHaveBeenCalled();
  });
});
