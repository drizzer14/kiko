import { right } from 'fnts/either';
import type { ComponentProps } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  defaultHoldingSymbol,
  holdingTypeSymbol,
  loanKindSymbol,
  propertyCategorySymbol,
} from '@kiko/holdings/entity-symbols';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { dayKeyOf } from '@kiko/prices/price-book';
import { darkTheme } from '@kiko/design-system/theme';
import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';
import type { Metal } from '@kiko/holdings/holding-metadata';
import { fieldSuffix } from '@kiko/test-support/field-suffix';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';
import { glyphNamesWithin } from '@kiko/test-support/glyph-names-within';
import { refreshBondRegisterIfStale } from '@kiko/bonds/bond-register-repo';
import { type HoldingType, holdingTypes } from '@kiko/holdings/holding-type';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';
import { spyOnModalAnimationPerTest } from '@kiko/test-support/modal-animation-spy';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

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
    updateMetadataFromStored: jest.fn(),
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
// On device the account row arrives on a later render than the first one.
let mockAccountLoaded = true;
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
let mockPricePointsLoading = false;
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
      return { data: mockPricePoints, isLoading: mockPricePointsLoading };
    }

    if (!mockAccountLoaded) {
      return { data: [] };
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

jest.mock('@kiko/db/use-live-query', () => ({
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
jest.mock('@kiko/bonds/bond-register-repo', () => ({
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
    createImplicitHolding: jest
      .fn()
      .mockResolvedValue({ accountId: 'implicit-account-id', holdingId: 'new-holding-id' }),
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
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

const navigation = navigationSpy();
const route = asRouteProp<HoldingFormProps['route']>('HoldingForm', { accountId: 'acc-1' });

const createMock = holdingsRepo.create as jest.Mock;
const createImplicitHoldingMock = accountsRepo.createImplicitHolding as jest.Mock;
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
// A bond edit builds its metadata from the row stored at the time of the
// write, so a test hands the captured builder that row.
const updateFromStoredMock = holdingsRepo.updateMetadataFromStored as jest.Mock;
const savedBondMetadata = (storedMetadata: unknown): Record<string, unknown> =>
  updateFromStoredMock.mock.calls[0][2](storedMetadata);

beforeEach(() => {
  mockAccountKind = 'bank';
  mockAccountLoaded = true;
  mockAccountInstitution = 'monobank';
  mockAccountBankId = null;
  mockEditHoldings = [];
  mockBondRegisterRows = [];
  mockBondRegisterFetchedAtRows = [{ value: 1 }];
  mockPricePoints = [];
  mockPricePointsLoading = false;
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

// Whether the term's Months/Years chip with this label is the selected one.
const unitChipSelected = (screen: Screen, label: 'Months' | 'Years'): boolean =>
  screen.getByText(label).parent?.props.accessibilityState.selected === true;

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
  await fill(screen, 'Coupon', '9');
  await pickDate(screen, 'Purchase date', 2026, 1, 1);
  await pickDate(screen, 'Maturity date', 2028, 1, 1);
};

const fillTermDepositFields = async (screen: Screen): Promise<void> => {
  await selectHoldingType(screen, 'term_deposit');
  await fill(screen, 'Name', 'My deposit');
  await fill(screen, 'Contribution 1 amount', '1000');
  await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
  await fill(screen, 'Annual rate', '12');
  await fill(screen, 'Term', '12');
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

  it('offers a new cash holding fiat currencies only', async () => {
    mockAccountKind = 'cash';
    const { getByTestId, queryByTestId, getByPlaceholderText } = await renderScreen();

    await fireEvent.press(getByTestId('holding-currency-field'));
    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'BTC');

    expect(queryByTestId('currency-option-BTC')).toBeNull();

    await fireEvent.changeText(getByPlaceholderText('Search by code or name'), 'EUR');

    expect(getByTestId('currency-option-EUR')).toBeTruthy();
  });

  it('lists crypto currencies first when creating a crypto holding', async () => {
    mockAccountKind = 'crypto';
    const { getByTestId, getAllByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('holding-currency-field'));

    const codes = getAllByTestId(/^currency-option-/).map((row) =>
      String(row.props.testID).replace('currency-option-', ''),
    );

    expect(codes.slice(0, 4)).toEqual(['BTC', 'ETH', 'USDT', 'UAH']);
  });

  // The currency sheet's search field lives
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

    for (const label of ['Annual rate', 'Term', 'Recapitalization', 'Compounding']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders a visible text label above every ISIN-mode bond field, defaulting to ISIN mode', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    // ISIN mode (the CREATE default) shows quantity/purchase date —
    // always visible — plus the mode toggle and the ISIN field itself.
    for (const label of ['Quantity', 'Purchase date', 'Purchase price per bond']) {
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
      'Coupon',
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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

  it('turns only the incomplete contribution row labels red with its error', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fireEvent.press(screen.getByText('Add contribution'));

    await fireEvent.press(screen.getByText('Save'));

    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 amount')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 date')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 2 amount')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 2 date')).toBe(true);

    await fill(screen, 'Contribution 2 amount', '500');
    await pickDate(screen, 'Contribution 2 date', 2026, 2, 1);

    expect(isLabelInvalid(mockFieldLabel, 'Contribution 2 amount')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 2 date')).toBe(false);
  });

  it('turns the contribution labels red with the missing-contribution error', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');

    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 amount')).toBe(false);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 date')).toBe(false);

    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText('Add at least one contribution with an amount and a date.'),
    ).toBeTruthy();
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 amount')).toBe(true);
    expect(isLabelInvalid(mockFieldLabel, 'Contribution 1 date')).toBe(true);
  });

  it('blocks save on a new contribution row that has only an amount, no date', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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

  // A blank price is "no price", not a price equal to the nominal: the
  // yield to maturity needs the price paid, so nothing is stored and
  // `asBondMeta` alone supplies the nominal default for the ledger.
  it('stores no purchase price for a Manual bond saved with a blank price', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate()).not.toHaveProperty('purchasePriceMinorUnits');
  });

  it('stores the price of one bond times the quantity as the total paid for a Manual bond', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fill(screen, 'Quantity', '98');
    await fill(screen, 'Purchase price per bond', '1 076,72');
    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().purchasePriceMinorUnits).toBe(10_551_856);
  });

  it('stores the total for the quantity at Save, even when the quantity changed after the price', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);
    await fill(screen, 'Purchase price per bond', '950');
    await fill(screen, 'Quantity', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().purchasePriceMinorUnits).toBe(1_140_000);
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
    await fill(screen, 'Purchase price per bond', '10 000');

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

  it('opens an edit of a bond saved in ISIN mode in ISIN mode', async () => {
    const screen = await renderEdit({
      ...bondHolding,
      metadata: { ...bondHolding.metadata, isin: 'UA4000234215', entryMode: 'isin' },
    });

    expect(
      screen.getByTestId('bond-isin-mode-control-option-isin').props.accessibilityState.selected,
    ).toBe(true);
    expect(isinInput(screen).props.value).toBe('UA4000234215');
  });

  it('opens an edit of a bond saved in Manual mode in Manual, with the stored ISIN shown and editable', async () => {
    const screen = await renderEdit({
      ...bondHolding,
      metadata: {
        ...bondHolding.metadata,
        isin: 'UA4000234215',
        entryMode: 'manual',
        payments: [{ date: localDay(2028, 1, 1), kind: 'redemption', amount: '1000' }],
      },
    });

    expect(
      screen.getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(true);
    expect(isinInput(screen).props.value).toBe('UA4000234215');

    await fireEvent.changeText(isinInput(screen), 'XS2895055981');
    await fireEvent.press(screen.getByText('Save'));

    expect(savedBondMetadata(bondHolding.metadata).isin).toBe('XS2895055981');
  });

  // The App Store demo bond (screenshot-seed.ts) as seeded: an invented ISIN
  // with a kept schedule, which leaves the cache on the first online register
  // refresh. A reviewer who edits it must still be able to save it.
  const demoBond = {
    id: 'h-demo-bond',
    name: 'ОВДП',
    type: 'bond',
    currency: 'UAH',
    balanceMinorUnits: 0,
    icon: null,
    color: null,
    metadata: {
      quantity: 30,
      faceValueMinorUnits: 100_000,
      couponPct: 16.2,
      purchaseDate: localDay(2026, 2, 18),
      purchasePriceMinorUnits: 3_060_000,
      maturityDate: localDay(2027, 8, 18),
      bondKind: 'government',
      couponFrequency: 'semiannually',
      isin: 'UA4000999015',
      payments: [
        { date: localDay(2026, 8, 19), kind: 'coupon', amount: '81' },
        { date: localDay(2027, 2, 17), kind: 'coupon', amount: '81' },
        { date: localDay(2027, 8, 18), kind: 'coupon', amount: '81' },
        { date: localDay(2027, 8, 18), kind: 'redemption', amount: '1000' },
      ],
    },
  };

  it('opens the demo bond, saved before the mode was stored, in Manual', async () => {
    const screen = await renderEdit(demoBond);

    expect(
      screen.getByTestId('bond-isin-mode-control-option-manual').props.accessibilityState.selected,
    ).toBe(true);
  });

  // User ruling: a kept schedule sets the coupon, so an edit cannot change it
  // or drop the schedule by typing over it.
  it('shows the demo bond coupon and frequency read-only from its kept schedule', async () => {
    const screen = await renderEdit(demoBond);

    expect(screen.getByLabelText('Coupon').props.value).toBe('16.2');
    expect(screen.getByLabelText('Coupon').props.editable).toBe(false);
    expect(
      screen.getByTestId('manual-bond-coupon-frequency-field').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('saves a Manual edit of the demo bond, against a register without its ISIN, with its stored values', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderEdit(demoBond);

    await fireEvent.press(screen.getByText('Save'));

    expect(updateFromStoredMock).toHaveBeenCalledTimes(1);
    expect(updateFromStoredMock.mock.calls[0][1]).toMatchObject({ name: 'ОВДП' });
    expect(savedBondMetadata(demoBond.metadata)).toEqual({
      ...demoBond.metadata,
      entryMode: 'manual',
    });
  });

  it('saves an ISIN-mode edit of an ISIN the register no longer lists with its stored terms, under the not-in-register note', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const holding = { ...demoBond, metadata: { ...demoBond.metadata, entryMode: 'isin' } };
    const screen = await renderEdit(holding);

    expect(screen.getByText('Not in the NBU register.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Save'));

    expect(updateFromStoredMock.mock.calls[0][1]).toMatchObject({ name: 'ОВДП' });
    expect(savedBondMetadata(holding.metadata)).toEqual(holding.metadata);
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
    await fill(screen, 'Purchase price per bond', '10 000');

    expect(screen.getByDisplayValue('Register Bond UA4000234215')).toBeTruthy();

    await fill(screen, 'Name', 'War bond 2029');
    await pickDate(screen, 'Purchase date', 2026, 1, 1);

    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].name).toBe('War bond 2029');
  });

  it('keeps a name typed before the ISIN, in ISIN mode and after a tap from Manual', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fill(screen, 'Name', 'War bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fireEvent.press(screen.getByTestId('bond-isin-mode-control-option-isin'));

    expect(within(screen.getByTestId('bond-isin-summary')).getByText(/9\.5/)).toBeTruthy();
    expect(screen.getByDisplayValue('War bond')).toBeTruthy();
    expect(screen.queryByDisplayValue('Register Bond UA4000234215')).toBeNull();
  });

  it('keeps the saved name and coupon of an edited bond after a tap on ISIN', async () => {
    mockBondRegisterRows = [
      { ...foundRegisterRow, terms: { ...foundRegisterRow.terms, currency: 'UAH' } },
    ];
    const screen = await renderEdit({
      ...bondHolding,
      metadata: { ...bondHolding.metadata, isin: 'UA4000234215' },
    });

    await fireEvent.press(screen.getByTestId('bond-isin-mode-control-option-isin'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateFromStoredMock.mock.calls[0][1]).toMatchObject({ name: 'Gov bond' });
    expect(savedBondMetadata(bondHolding.metadata)).toMatchObject({ couponPct: 9 });
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
    await fill(screen, 'Purchase price per bond', '10 000');

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
    await fill(screen, 'Purchase price per bond', '10 000');

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
    await fill(screen, 'Purchase price per bond', '10 000');

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.queryByText('No purchase date selected.')).toBeNull();
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  // The yield to maturity needs the price actually paid, so ISIN mode never
  // falls back to the nominal the way Manual mode does.
  it('blocks save with a visible price error in ISIN mode until a price is typed', async () => {
    mockBondRegisterRows = [foundRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(isinInput(screen), 'UA4000234215');
    await fill(screen, 'Quantity', '10');

    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter the purchase price.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();

    await fill(screen, 'Purchase price per bond', '1 076,72');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].metadata.purchasePriceMinorUnits).toBe(1_076_720);
  });

  it('keeps the purchase price optional in Manual mode', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.queryByText('Enter the purchase price.')).toBeNull();
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
    expect(updateFromStoredMock).not.toHaveBeenCalled();
  });
});

// 98 x UA4000239115 bought at 1,076.72 each on 2026-09-10; the seller shows
// a 15.40% yield to maturity.
describe('HoldingFormScreen bond yield to maturity', () => {
  const yieldRow = (screen: Screen) => screen.queryByTestId('bond-form-yield-to-maturity');

  const pinnedRegisterRow = {
    isin: 'UA4000239115',
    terms: {
      isin: 'UA4000239115',
      currency: 'UAH',
      faceValueMinorUnits: 100_000,
      couponPct: 15.18,
      maturityDate: localDay(2027, 9, 15),
      couponFrequency: 'semiannually',
      name: 'Середньострокові UA4000239115',
      payments: [
        { date: localDay(2026, 9, 16), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 3, 17), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 9, 15), kind: 'coupon', amount: '75.9' },
        { date: localDay(2027, 9, 15), kind: 'redemption', amount: '1000' },
      ],
    },
    fetchedAt: 1,
  };

  it('shows the yield of an ISIN bond from the register payments, once it has a price', async () => {
    mockBondRegisterRows = [pinnedRegisterRow];
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.changeText(screen.getByPlaceholderText('UA4000234215'), 'UA4000239115');
    await fill(screen, 'Quantity', '98');
    await pickDate(screen, 'Purchase date', 2026, 9, 10);

    expect(yieldRow(screen)).toBeNull();

    await fill(screen, 'Purchase price per bond', '1 076,72');

    expect(screen.getByText('Yield to maturity')).toBeTruthy();
    expect(yieldRow(screen)).toHaveTextContent('15.40%');

    await fill(screen, 'Purchase price per bond', '1 000');

    expect(yieldRow(screen)).not.toHaveTextContent('15.40%');
  });

  it('shows the same yield for a Manual bond from its generated schedule, once it has a maturity', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');
    await fireEvent.press(screen.getByText('Manual'));
    await fill(screen, 'Quantity', '98');
    await fill(screen, 'Purchase price per bond', '1 076,72');
    await fill(screen, 'Face value', '1000');
    await fill(screen, 'Coupon', '15.18');
    await pickDate(screen, 'Purchase date', 2026, 9, 10);

    expect(yieldRow(screen)).toBeNull();

    await pickDate(screen, 'Maturity date', 2027, 9, 15);

    expect(yieldRow(screen)).toHaveTextContent('15.40%');
  });

  it('shows the yield of a stored bond in the edit form', async () => {
    const screen = await renderEdit({
      ...bondHolding,
      metadata: {
        quantity: 98,
        faceValueMinorUnits: 100_000,
        couponPct: 15.18,
        purchasePriceMinorUnits: 10_551_856,
        purchaseDate: localDay(2026, 9, 10),
        maturityDate: localDay(2027, 9, 15),
        bondKind: 'government',
        couponFrequency: 'semiannually',
        entryMode: 'manual',
      },
    });

    expect(yieldRow(screen)).toHaveTextContent('15.40%');
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
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Annual rate').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('shows the term reason directly on that field, once the rate is set but the term is missing', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Term').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('saves a deposit term typed in years as months', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);
    await fill(screen, 'Term', '2');
    await fireEvent.press(screen.getByText('Years'));
    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().termMonths).toBe(24);
  });

  it('rejects a fractional number of years', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);
    await fill(screen, 'Term', '1.5');
    await fireEvent.press(screen.getByText('Years'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of years greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('keeps the typed number across a unit switch and revalidates it in the new unit', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);
    await fill(screen, 'Term', '60');
    await fireEvent.press(screen.getByText('Years'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of years from 1 to 50.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Months'));

    expect(screen.getByLabelText('Term').props.value).toBe('60');
    expect(screen.queryByText('Enter a whole number of years from 1 to 50.')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().termMonths).toBe(60);
  });

  it('seeds a 36-month deposit term as 3 years', async () => {
    const screen = await renderEdit({
      ...depositHolding,
      metadata: { ...depositHolding.metadata, termMonths: 36 },
    });

    expect(screen.getByLabelText('Term').props.value).toBe('3');
    expect(unitChipSelected(screen, 'Years')).toBe(true);
  });

  it('names the maximum once the term deposit term exceeds MAX_TERM_MONTHS', async () => {
    const screen = await renderScreen();

    await selectHoldingType(screen, 'term_deposit');
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 amount', '1000');
    await pickDate(screen, 'Contribution 1 date', 2026, 1, 1);
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', String(MAX_TERM_MONTHS + 1));
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '12');

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

    await fill(screen, 'Annual rate', '12');

    expect(screen.queryByText('Enter a rate of 0 or higher.')).toBeNull();
    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();

    await fill(screen, 'Term', '12');

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
    await fill(screen, 'Coupon', '9');
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
    const flatStyle = StyleSheet.flatten(screen.getByLabelText('Coupon').props.style);
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
    await fill(screen, 'Coupon', '9');
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

    await fill(screen, 'Annual rate', '12');
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

describe('HoldingFormScreen property ownership', () => {
  const firstDay = Date.UTC(2024, 0, 1);
  const storedLots = [{ day: firstDay, quantityDelta: '1', costMinorUnits: 900_000 }];
  const sharedApartment = (metadata: Record<string, unknown> = {}) => ({
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
      lots: storedLots,
      ownership: [{ day: firstDay, numerator: 1, denominator: 3 }],
      ownershipInput: 'fraction',
      ...metadata,
    },
  });
  const createdMetadata = (): Record<string, unknown> => createMock.mock.calls[0][0].metadata;
  const savedMetadata = (): Record<string, unknown> => updateDeltaMock.mock.calls[0][1].metadata;

  beforeEach(() => {
    createMock.mockClear();
    navigation.goBack.mockClear();
    updateDeltaMock.mockClear();
    mockAccountKind = 'property';
    mockAccountInstitution = null;
  });

  const fillNewProperty = async (screen: Screen): Promise<void> => {
    await fill(screen, 'Name', 'Apartment');
    await fill(screen, 'Cost', '9000');
  };

  it('creates a property at 50% with one change on the lot day', async () => {
    const screen = await renderScreen();

    await fillNewProperty(screen);
    await fill(screen, 'Share', '50');
    await fireEvent.press(screen.getByText('Save'));

    const metadata = createdMetadata() as { lots: { day: number }[] };
    expect(metadata).toEqual(
      expect.objectContaining({
        ownership: [{ day: metadata.lots[0].day, numerator: 1, denominator: 2 }],
        ownershipInput: 'percent',
      }),
    );
  });

  it('creates a property at a third typed as a fraction', async () => {
    const screen = await renderScreen();

    await fillNewProperty(screen);
    await fireEvent.press(screen.getByText('Fraction'));
    await fill(screen, 'Share', '1');
    await fill(screen, 'Out of', '3');
    await fireEvent.press(screen.getByText('Save'));

    expect(createdMetadata()).toEqual(
      expect.objectContaining({
        ownership: [{ day: expect.any(Number), numerator: 1, denominator: 3 }],
        ownershipInput: 'fraction',
      }),
    );
  });

  it('writes no ownership key for the default 100%', async () => {
    const screen = await renderScreen();

    expect(screen.getByLabelText('Share').props.value).toBe('100');

    await fillNewProperty(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(createdMetadata()).not.toHaveProperty('ownership');
    expect(createdMetadata()).not.toHaveProperty('ownershipInput');
  });

  it.each([
    ['percent', '0', ''],
    ['percent', '101', ''],
    ['fraction', '2', '1'],
  ])('blocks save on a %s share of %s %s', async (mode, share, outOf) => {
    const screen = await renderScreen();

    await fillNewProperty(screen);

    if (mode === 'fraction') {
      await fireEvent.press(screen.getByText('Fraction'));
      await fill(screen, 'Out of', outOf);
    }
    await fill(screen, 'Share', share);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a share above 0 and up to 100%.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('pre-fills the stored input form and the share in effect on edit', async () => {
    const screen = await renderEdit(sharedApartment());

    expect(screen.getByLabelText('Share').props.value).toBe('1');
    expect(screen.getByLabelText('Out of').props.value).toBe('3');
    expect(screen.queryByLabelText('Effective from')).toBeNull();
  });

  it('keeps the stored list unchanged when the share is saved as it was', async () => {
    const screen = await renderEdit(sharedApartment());

    await fireEvent.press(screen.getByText('Save'));

    expect(savedMetadata()).toEqual({
      category: 'real_estate',
      lots: storedLots,
      ownership: [{ day: firstDay, numerator: 1, denominator: 3 }],
      ownershipInput: 'fraction',
    });
  });

  it('appends a change effective from a picked past day, keeping the earlier one', async () => {
    const screen = await renderEdit(sharedApartment());

    await fill(screen, 'Out of', '2');
    await pickDate(screen, 'Effective from', 2025, 6, 1);
    await fireEvent.press(screen.getByText('Save'));

    expect(savedMetadata()).toEqual(
      expect.objectContaining({
        ownership: [
          { day: firstDay, numerator: 1, denominator: 3 },
          { day: Date.UTC(2025, 5, 1), numerator: 1, denominator: 2 },
        ],
        ownershipInput: 'fraction',
      }),
    );
  });

  it('hides the field for a loan given and writes no key on create', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('property-category-field'));
    await fireEvent.press(screen.getByTestId('property-category-field-option-loan_given'));

    expect(screen.queryByText('Ownership')).toBeNull();

    await fillNewProperty(screen);
    await fireEvent.press(screen.getByText('Save'));

    expect(createdMetadata()).not.toHaveProperty('ownership');
  });

  it('keeps the stored list when the category switches to one that hides the field', async () => {
    const screen = await renderEdit(sharedApartment());

    await fireEvent.press(screen.getByTestId('property-category-field'));
    await fireEvent.press(screen.getByTestId('property-category-field-option-loan_given'));

    expect(screen.queryByLabelText('Share')).toBeNull();

    await fireEvent.press(screen.getByText('Save'));

    expect(savedMetadata()).toEqual({
      category: 'loan_given',
      lots: storedLots,
      ownership: [{ day: firstDay, numerator: 1, denominator: 3 }],
      ownershipInput: 'fraction',
    });
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
  // `src/navigation/root-navigator/statement-import-return.navigator.test.tsx`.
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

  // Purity is typed as a fineness per mille and stored as the 0..1 ratio,
  // shifted exactly (never through a float), with a comma decimal mark read
  // as a dot.
  it.each([
    ['999,9', '0.9999'],
    ['585', '0.585'],
    ['1000', '1'],
  ])('stores a typed %s fineness as the %s ratio', async (fineness, stored) => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'Gold bar');
    await fill(screen, 'Purity', fineness);
    await fill(screen, 'Quantity', '31.1');
    await fill(screen, 'Total cost', '80000');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ purity: stored }),
      }),
    );
  });

  // Validated with the SAME `normalizeDecimal` parser the writer uses, so a
  // shape it rejects (leading dot, trailing dot, junk) blocks Save rather
  // than being written as some other value the user never typed.
  it.each(['0', '1000.1', 'abc', '.999', '1.'])(
    'blocks save and shows the fineness error for a purity of %s',
    async (purity) => {
      const screen = await renderScreen();

      await fill(screen, 'Name', 'Gold bar');
      await fill(screen, 'Purity', purity);
      await fill(screen, 'Quantity', '31.1');
      await fill(screen, 'Total cost', '80000');
      await fireEvent.press(screen.getByText('Save'));

      expect(screen.getByText('Enter a fineness above 0 and up to 1000 ‰.')).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();
    },
  );

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

  // Writes the purity the user typed, never the value the holding was
  // hydrated with — deliberately different from the hydrated 999.9 so a
  // substitution bug can't hide behind a coincidental match.
  it('edits a metal holding writing the typed purity, not the hydrated one', async () => {
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

    expect(screen.getByLabelText('Purity').props.value).toBe('999.9');

    await fill(screen, 'Purity', '750');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({
        metadata: expect.objectContaining({ purity: '0.75' }),
      }),
      expect.any(Number),
    );
  });

  // Purity stays user-editable in edit mode (unlike
  // Quantity/Total cost, which are create-only), so it must validate there
  // too.
  it('blocks save for an out-of-range purity in EDIT mode too, leaving the stored MetalMeta untouched', async () => {
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

    await fill(screen, 'Purity', '1000.1');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a fineness above 0 and up to 1000 ‰.')).toBeTruthy();
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

describe('HoldingFormScreen broker', () => {
  beforeEach(() => {
    createMock.mockClear();
    navigation.goBack.mockClear();
    mockAccountKind = 'broker';
    mockAccountInstitution = null;
    mockAccountBankId = 'trading212';
  });

  it('offers bond first, then cash, on a broker account', async () => {
    const screen = await renderScreen();

    await openHoldingTypeSheet(screen);

    expect(typeOptionIds(screen)).toEqual([
      'holding-type-field-option-bond',
      'holding-type-field-option-cash',
    ]);
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

  it('titles the create header "Add Loan" on a debt account', async () => {
    navigation.setOptions.mockClear();

    await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Loan' });
  });

  const carLoan = {
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
  };

  it('titles the edit header "Edit Loan", never "Edit Holding"', async () => {
    navigation.setOptions.mockClear();

    await renderEdit(carLoan);

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Loan' });
    expect(navigation.setOptions).not.toHaveBeenCalledWith({ title: 'Edit Holding' });
  });

  it('titles the edit header "Edit Loan" from its route before the account row loads', async () => {
    mockAccountLoaded = false;
    mockEditHoldings = [carLoan];
    navigation.setOptions.mockClear();

    await render(
      <HoldingFormScreen
        navigation={navigationProp(navigation)}
        route={asRouteProp<HoldingFormProps['route']>('HoldingForm', {
          accountId: 'acc-1',
          holdingId: 'h1',
          debtAccount: true,
        })}
      />,
    );

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Loan' });
    expect(navigation.setOptions).not.toHaveBeenCalledWith({ title: 'Edit Holding' });
  });

  const fillLoanFields = async (screen: Screen): Promise<void> => {
    await fill(screen, 'Name', 'Car loan');
    await fill(screen, 'Principal', '500000');
    await pickDate(screen, 'Start date', 2026, 1, 1);
  };

  it('creates an annuity loan with a full LoanMeta and no firstPricePoint', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '24');
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '24');
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
    await fill(screen, 'Annual rate', '9');
    await fill(screen, 'Term', '36');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: 'car_loan' }) }),
    );
  });

  describe('loan kind in the Type slot', () => {
    it('fills the Type slot with the four loan kinds, each with its own icon, and no loan type picker', async () => {
      const screen = await renderScreen();

      expect(screen.queryByTestId('holding-type-field')).toBeNull();
      expect(screen.getAllByTestId('loan-kind-field')).toHaveLength(1);
      expect(screen.getByTestId('loan-kind-field')).toHaveTextContent('Mortgage');

      await fireEvent.press(screen.getByTestId('loan-kind-field'));

      expect(
        screen.getAllByTestId(/^loan-kind-field-option-/).map((row) => String(row.props.testID)),
      ).toEqual([
        'loan-kind-field-option-mortgage',
        'loan-kind-field-option-car_loan',
        'loan-kind-field-option-consumer_loan',
        'loan-kind-field-option-personal',
      ]);
      expect(glyphNamesWithin(screen.getByTestId('loan-kind-field-option-mortgage'))).toContain(
        'house.circle.fill',
      );
      expect(glyphNamesWithin(screen.getByTestId('loan-kind-field-option-car_loan'))).toContain(
        'car.fill',
      );
      expect(
        glyphNamesWithin(screen.getByTestId('loan-kind-field-option-consumer_loan')),
      ).toContain('cart.fill');
      expect(glyphNamesWithin(screen.getByTestId('loan-kind-field-option-personal'))).toContain(
        'person.fill',
      );
    });

    it('keeps the stored holding type loan whichever kind is picked', async () => {
      const screen = await renderScreen();

      await fireEvent.press(screen.getByTestId('loan-kind-field'));
      await fireEvent.press(screen.getByTestId('loan-kind-field-option-personal'));
      await fillLoanFields(screen);
      await fireEvent.press(screen.getByText('No schedule'));
      await fireEvent.press(screen.getByText('Save'));

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'loan',
          metadata: expect.objectContaining({ kind: 'personal' }),
        }),
      );
    });

    it('seeds the icon tile from the picked kind until the user picks an icon', async () => {
      const screen = await renderScreen();

      expect(screen.getByLabelText('Icon house.circle.fill')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('loan-kind-field'));
      await fireEvent.press(screen.getByTestId('loan-kind-field-option-car_loan'));

      expect(screen.getByLabelText('Icon car.fill')).toBeTruthy();

      await fireEvent.press(screen.getByLabelText('Change Icon'));
      await fireEvent.press(screen.getByLabelText('Choose icon giftcard'));
      await fireEvent.press(screen.getByTestId('loan-kind-field'));
      await fireEvent.press(screen.getByTestId('loan-kind-field-option-consumer_loan'));

      expect(screen.getByLabelText('Icon giftcard')).toBeTruthy();
      expect(screen.queryByLabelText('Icon cart.fill')).toBeNull();
    });

    it('stores no icon for an untouched one, so the card keeps following the kind', async () => {
      const screen = await renderScreen();

      await fireEvent.press(screen.getByTestId('loan-kind-field'));
      await fireEvent.press(screen.getByTestId('loan-kind-field-option-car_loan'));
      await fillLoanFields(screen);
      await fill(screen, 'Annual rate', '9');
      await fill(screen, 'Term', '36');
      await fireEvent.press(screen.getByText('Save'));

      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ icon: null }));
    });

    it('hydrates the stored kind on edit, still editable, with the tile following it', async () => {
      const screen = await renderEdit(carLoan);

      expect(screen.queryByTestId('holding-type-field')).toBeNull();
      expect(screen.getByTestId('loan-kind-field')).toHaveTextContent('Car loan');
      expect(screen.getByTestId('loan-kind-field').props.accessibilityState?.disabled).not.toBe(
        true,
      );
      expect(screen.getByLabelText('Icon car.fill')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('loan-kind-field'));
      await fireEvent.press(screen.getByTestId('loan-kind-field-option-personal'));
      await fireEvent.press(screen.getByText('Save'));

      expect(updateLoanMock).toHaveBeenCalledWith(
        'h1',
        expect.objectContaining({ metadata: expect.objectContaining({ kind: 'personal' }) }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('keeps the stored icon of a loan that has one, whatever its kind', async () => {
      const screen = await renderEdit({ ...carLoan, icon: 'giftcard' });

      expect(screen.getByLabelText('Icon giftcard')).toBeTruthy();
      expect(screen.queryByLabelText('Icon car.fill')).toBeNull();
    });

    it('shows the first kind for a loan whose stored kind is invalid, as today', async () => {
      const screen = await renderEdit({
        ...carLoan,
        metadata: { ...carLoan.metadata, kind: 'nonsense' },
      });

      expect(screen.getByTestId('loan-kind-field')).toHaveTextContent('Mortgage');
    });
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

    expect(screen.queryByLabelText('Annual rate')).toBeNull();
    expect(screen.queryByLabelText('Term')).toBeNull();

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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '0');
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of months greater than 0.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a loan term above the years maximum, naming it in years', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '51');
    await fireEvent.press(screen.getByText('Years'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByText('Enter a whole number of years from 1 to 50.')).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('seeds an 18-month loan term in months', async () => {
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
        termMonths: 18,
      },
    });

    expect(screen.getByLabelText('Term').props.value).toBe('18');
    expect(unitChipSelected(screen, 'Months')).toBe(true);
  });

  it('names the maximum once the loan term exceeds MAX_TERM_MONTHS', async () => {
    const screen = await renderScreen();

    await fillLoanFields(screen);
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', String(MAX_TERM_MONTHS + 1));
    await fireEvent.press(screen.getByText('Save'));

    expect(
      screen.getByText(`Enter a whole number of months from 1 to ${MAX_TERM_MONTHS}.`),
    ).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('renders a visible text label above every loan field', async () => {
    const screen = await renderScreen();

    expect(screen.getByText('Type')).toBeTruthy();
    expect(screen.queryByText('Loan kind')).toBeNull();
    expect(screen.getByLabelText('Principal')).toBeTruthy();
    expect(screen.getByLabelText('Start date')).toBeTruthy();
    expect(screen.getByText('Schedule')).toBeTruthy();
    expect(screen.getByLabelText('Annual rate')).toBeTruthy();
    expect(screen.getByLabelText('Term')).toBeTruthy();
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
    expect(screen.getByLabelText('Annual rate').props.value).toBe('12');
    // A whole number of years seeds in years; saving it untouched writes the
    // same 24 months back.
    expect(screen.getByLabelText('Term').props.value).toBe('2');
    expect(unitChipSelected(screen, 'Years')).toBe(true);

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

    expect(screen.queryByLabelText('Annual rate')).toBeNull();
    expect(screen.queryByLabelText('Term')).toBeNull();

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

  // 'none' -> a schedule drops the start-day point the informal loan's create
  // wrote: it holds the old principal, and a scheduled loan would count down
  // from it as a correction.
  it('(c) switching a "none" loan to annuity drops its start-day point', async () => {
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
    await fill(screen, 'Annual rate', '10');
    await fill(screen, 'Term', '12');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateLoanMock).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ metadata: expect.objectContaining({ schedule: 'annuity' }) }),
      { kind: 'delete', day: dayKeyOf(localDay(2026, 1, 1)) },
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
    await fill(screen, 'Annual rate', '12');
    await fill(screen, 'Term', '24');
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

  it('hands the picked icon to create, in the same write as the row, with no second write', async () => {
    // A cash holding is valid with just a name (a bank create defaults to a term
    // deposit, which needs contributions), so it is the simplest create path.
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText('Choose icon banknote'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ icon: 'banknote' }));
    expect(setIconMock).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('a failed Save then a retry sends the whole create again and never a second icon write', async () => {
    // The create is ONE write that rolls back whole (holdings.repo.create-icon
    // test), so the failed attempt leaves no row and the retry makes exactly
    // one. A separate icon write could fail after the row was committed, and
    // the retry would then make a duplicate.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    createMock.mockRejectedValueOnce(new Error('disk full'));
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText('Choose icon banknote'));
    await fireEvent.press(screen.getByText('Save'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ icon: 'banknote' }));
    expect(setIconMock).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
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

  it('creates with no icon when none is picked', async () => {
    mockAccountKind = 'cash';
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My cash');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ icon: null }));
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

describe('HoldingFormScreen units', () => {
  it('shows % after the deposit rate and months after its term', async () => {
    mockAccountKind = 'bank';
    const screen = await renderScreen();

    expect(fieldSuffix(screen.getByLabelText('Annual rate'))).toBe('%');
    expect(fieldSuffix(screen.getByLabelText('Term'))).toBe('mo');
  });

  it('shows pieces after the bond quantity in both bond modes', async () => {
    mockAccountKind = 'bank';
    const screen = await renderScreen();

    await selectHoldingType(screen, 'bond');

    expect(fieldSuffix(screen.getByLabelText('Quantity'))).toBe('pcs');

    await fireEvent.press(screen.getByText('Manual'));

    expect(fieldSuffix(screen.getByLabelText('Quantity'))).toBe('pcs');
  });

  it('moves the metal quantity unit with the Unit chip', async () => {
    mockAccountKind = 'metals';
    const screen = await renderScreen();

    expect(fieldSuffix(screen.getByLabelText('Quantity'))).toBe('oz');

    await fireEvent.press(screen.getByText('Grams'));

    expect(fieldSuffix(screen.getByLabelText('Quantity'))).toBe('g');
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
    expect(screen.getByLabelText('Term').props.value).toBe('2');

    await fill(screen, 'Annual rate', '15');
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

  it('seeds a bond and saves its edited metadata from the stored row', async () => {
    const screen = await renderEdit(bondHolding);

    // Stored bond fields seed the inputs (quantity, coupon %, corporate kind).
    expect(screen.getByDisplayValue('10')).toBeTruthy();
    expect(screen.getByDisplayValue('9')).toBeTruthy();
    expect(screen.getByText('Corporate').parent?.props.accessibilityState.selected).toBe(true);

    await fill(screen, 'Coupon', '11');
    await fireEvent.press(screen.getByText('Save'));

    expect(updateFromStoredMock.mock.calls[0][1]).toEqual({
      name: bondHolding.name,
      color: bondHolding.color,
    });
    expect(savedBondMetadata(bondHolding.metadata)).toMatchObject({
      couponPct: 11,
      quantity: 10,
      bondKind: 'corporate',
      purchasePriceMinorUnits: 950_000,
    });
    expect(updateDeltaMock).not.toHaveBeenCalled();
  });

  it('seeds the price of one bond from the stored total', async () => {
    const screen = await renderEdit({
      ...bondHolding,
      metadata: { ...bondHolding.metadata, quantity: 98, purchasePriceMinorUnits: 10_551_856 },
    });

    expect(screen.getByLabelText('Purchase price per bond').props.value).toBe('1 076.72');
  });

  it('re-saves an untouched total that does not divide by the quantity unchanged', async () => {
    const metadata = { ...bondHolding.metadata, quantity: 3, purchasePriceMinorUnits: 1_000_000 };
    const screen = await renderEdit({ ...bondHolding, metadata });

    expect(screen.getByLabelText('Purchase price per bond').props.value).toBe('3 333.33');

    await fireEvent.press(screen.getByText('Save'));

    expect(savedBondMetadata(metadata).purchasePriceMinorUnits).toBe(1_000_000);
  });

  it('seeds a blank price for a bond stored without one, and re-saves it still without one', async () => {
    const { purchasePriceMinorUnits: _, ...unpricedMetadata } = bondHolding.metadata;
    const screen = await renderEdit({ ...bondHolding, metadata: unpricedMetadata });

    expect(screen.getByLabelText('Purchase price per bond').props.value).toBe('');

    await fireEvent.press(screen.getByText('Save'));

    expect(savedBondMetadata(unpricedMetadata)).not.toHaveProperty('purchasePriceMinorUnits');
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

describe('HoldingFormScreen — the icon picker offers the default glyph of every holding', () => {
  const storedHolding = (
    type: HoldingType,
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> => ({
    id: 'h1',
    accountId: 'acc-1',
    name: 'Holding',
    type,
    currency: 'UAH',
    balanceMinorUnits: 0,
    icon: 'giftcard',
    color: null,
    metadata,
  });

  const loanMetadata = (kind: string) => ({
    kind,
    principalMinorUnits: 50_000_000,
    startDate: localDay(2026, 1, 1),
    schedule: 'annuity',
    annualRatePct: 12,
    termMonths: 24,
  });

  const propertyMetadata = (category: string) => ({
    category,
    lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAllHoldings = [];
  });

  const cases: readonly (readonly [string, HoldingType, Record<string, unknown> | undefined])[] = [
    ['a card', 'card', undefined],
    ['a cash holding', 'cash', undefined],
    ['a crypto asset', 'crypto_asset', undefined],
    ['a jar', 'jar', undefined],
    ...Object.keys(loanKindSymbol).map(
      (kind) => [`a ${kind} loan`, 'loan', loanMetadata(kind)] as const,
    ),
    ...Object.keys(propertyCategorySymbol).map(
      (category) =>
        [`a ${category} property`, 'property_item', propertyMetadata(category)] as const,
    ),
  ];

  it.each(cases)(
    'lets %s that stores a custom icon pick its default glyph back',
    async (_label, type, metadata) => {
      const defaultIcon = defaultHoldingSymbol({ type, metadata });
      const screen = await renderEdit(storedHolding(type, metadata));

      await fireEvent.press(screen.getByLabelText('Change Icon'));

      const offered = screen
        .getAllByLabelText(/^Choose icon /)
        .map((option) => String(option.props.accessibilityLabel).replace('Choose icon ', ''));

      expect(offered.filter((icon) => icon === defaultIcon)).toHaveLength(1);

      await fireEvent.press(screen.getByLabelText(`Choose icon ${defaultIcon}`));

      expect(screen.getByLabelText(`Icon ${defaultIcon}`)).toBeTruthy();
    },
  );

  it('stores the default glyph it picked back on Save', async () => {
    const screen = await renderEdit(storedHolding('card'));

    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText(`Choose icon ${holdingTypeSymbol.card}`));
    await fireEvent.press(screen.getByText('Save'));

    expect(setIconMock).toHaveBeenCalledWith('h1', holdingTypeSymbol.card);
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

    const { getByText, getByTestId, getByLabelText } = await renderScreen();
    await fireEvent.press(getByTestId('holding-type-field'));
    await fireEvent.press(getByTestId('holding-type-field-option-bond'));
    await fireEvent.press(getByText('Вручну'));

    // `forms.holding.details` is the shared heading of the property, metal,
    // bond, and loan blocks, so it reads a generic "Details", not a
    // bond-specific one.
    expect(getByText('Деталі')).toBeTruthy();
    expect(getByText('Кількість')).toBeTruthy();
    expect(getByText('Номінальна вартість')).toBeTruthy();
    expect(getByText('Купон')).toBeTruthy();
    expect(fieldSuffix(getByLabelText('Кількість'))).toBe('шт.');
    expect(getByText('Дата придбання')).toBeTruthy();
    expect(getByText('Ціна придбання за облігацію')).toBeTruthy();
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

  // A loan edit reads its current outstanding off the book; saved before the
  // book loads, a change into 'none' would store the schedule-only value as a
  // permanent manual point.
  it('disables Save on a loan edit until the price book has loaded', async () => {
    const loan = {
      id: 'h1',
      accountId: 'acc-1',
      name: 'Car loan',
      type: 'loan',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
      metadata: {
        kind: 'personal',
        principalMinorUnits: 100_000_00,
        startDate: localDay(2026, 1, 1),
        annualRatePct: 10,
        termMonths: 12,
        schedule: 'annuity',
      },
    };
    mockPricePointsLoading = true;
    const screen = await renderEdit(loan);

    expect(screen.getByText('Save')).toBeDisabled();

    mockPricePointsLoading = false;
    await screen.rerender(
      <HoldingFormScreen
        navigation={navigationProp(navigation)}
        route={asRouteProp<HoldingFormProps['route']>('HoldingForm', {
          accountId: 'acc-1',
          holdingId: 'h1',
        })}
      />,
    );

    expect(screen.getByText('Save')).not.toBeDisabled();
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

    expect(mockRefreshMarketData).toHaveBeenCalledWith({
      throttled: false,
      metals: true,
    });
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

describe('HoldingFormScreen name placeholder', () => {
  // One example name per holding type, so the empty Name field never suggests
  // a bond for a deposit, a loan, or a metal.
  const createCases: [HoldingType, string, string | null, string][] = [
    ['card', 'bank', null, 'Salary card'],
    ['term_deposit', 'bank', 'monobank', '6-month deposit'],
    ['bond', 'bank', 'monobank', 'Government bonds'],
    ['cash', 'cash', 'monobank', 'Cash at home'],
    ['crypto_asset', 'crypto', 'monobank', 'Bitcoin'],
    ['property_item', 'property', 'monobank', 'Apartment or car'],
    ['metal', 'metals', 'monobank', 'Gold bar'],
    ['loan', 'debt', 'monobank', 'Mortgage'],
  ];

  it.each(createCases)(
    'shows the %s example on a create under a %s account',
    async (type, accountKind, institution, placeholder) => {
      mockAccountKind = accountKind;
      mockAccountInstitution = institution;
      const screen = await renderScreen();

      if (accountKind === 'bank') {
        await selectHoldingType(screen, type);
      }

      expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
    },
  );

  it('shows the jar example on an existing jar, which is never manually created', async () => {
    const screen = await renderEdit({
      id: 'h-9',
      name: '',
      type: 'jar',
      currency: 'UAH',
      balanceMinorUnits: 0,
      icon: null,
      color: null,
    });

    expect(screen.getByPlaceholderText('Vacation jar')).toBeTruthy();
  });

  it('covers every holding type, each with its own example', () => {
    const coveredTypes = [...createCases.map(([type]) => type), 'jar'];
    const examples = [...createCases.map(([, , , placeholder]) => placeholder), 'Vacation jar'];

    expect([...coveredTypes].sort()).toEqual([...holdingTypes].sort());
    expect(new Set(examples).size).toBe(holdingTypes.length);
  });
});

describe('HoldingFormScreen implicit create', () => {
  type Params = HoldingFormProps['route']['params'];

  const routeFor = (params: Params) =>
    asRouteProp<HoldingFormProps['route']>('HoldingForm', params);

  const renderImplicit = (params: Params) =>
    render(<HoldingFormScreen navigation={navigationProp(navigation)} route={routeFor(params)} />);

  const pickKind = async (screen: Screen, kind: string): Promise<void> => {
    await fireEvent.press(screen.getByTestId('account-kind-field'));
    const sheet = screen.getByTestId('account-kind-field-sheet-modal');
    await fireEvent.press(screen.getByTestId(`account-kind-field-option-${kind}`));
    // The sheet's close animation ending, which is when a swap may navigate.
    await act(async () => sheet.props.onDismiss());
  };

  beforeEach(() => {
    // The implicit form queries no account (`byIdQuery('')` matches no row).
    mockAccountLoaded = false;
    createMock.mockClear();
    setIconMock.mockClear();
    createImplicitHoldingMock.mockClear();
    navigation.goBack.mockClear();
    navigation.replace.mockClear();
    navigation.setParams.mockClear();
    navigation.setOptions.mockClear();
    mockRefreshMarketData.mockClear();
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockClear();
    (scrollToField as jest.Mock).mockClear();
  });

  it.each(['property', 'debt'] as const)(
    'titles the create header "Add Account" for %s, never "Add Loan"',
    async (implicitKind) => {
      await renderImplicit({ implicitKind });

      expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Account' });
      expect(navigation.setOptions).not.toHaveBeenCalledWith({ title: 'Add Loan' });
      expect(navigation.setOptions).not.toHaveBeenCalledWith({ title: 'Add Holding' });
    },
  );

  it('shows the property fields under the kind field, with no account or type pickers', async () => {
    const screen = await renderImplicit({ implicitKind: 'property' });

    expect(screen.getByTestId('account-kind-field')).toHaveTextContent('Property');
    expect(screen.getByTestId('property-category-field')).toHaveTextContent('Real estate');
    expect(screen.getByLabelText('Cost')).toBeTruthy();
    expect(screen.queryByTestId('holding-type-field')).toBeNull();
    expect(screen.queryByTestId('account-bank-type-field')).toBeNull();
    expect(screen.queryByTestId('account-broker-type-field')).toBeNull();
  });

  it('shows the loan fields under the kind field, offering the loan kinds in the Type slot', async () => {
    const screen = await renderImplicit({ implicitKind: 'debt' });

    expect(screen.getByTestId('account-kind-field')).toHaveTextContent('Debt');
    expect(screen.getByLabelText('Principal')).toBeTruthy();
    expect(screen.queryByTestId('holding-type-field')).toBeNull();

    await fireEvent.press(screen.getByTestId('loan-kind-field'));

    expect(
      screen.getAllByTestId(/^loan-kind-field-option-/).map((row) => String(row.props.testID)),
    ).toEqual([
      'loan-kind-field-option-mortgage',
      'loan-kind-field-option-car_loan',
      'loan-kind-field-option-consumer_loan',
      'loan-kind-field-option-personal',
    ]);
  });

  it('offers every account kind in the kind sheet, in the account form order', async () => {
    const screen = await renderImplicit({ implicitKind: 'property' });

    await fireEvent.press(screen.getByTestId('account-kind-field'));

    const order = screen
      .getAllByTestId(/^account-kind-field-option-[a-z]+$/)
      .map((node) => String(node.props.testID).replace('account-kind-field-option-', ''));

    expect(order).toEqual(['bank', 'cash', 'crypto', 'property', 'metals', 'debt', 'broker']);
  });

  it('offers the kind field in the active language', async () => {
    await i18n.changeLanguage('uk');

    try {
      const screen = await renderImplicit({ implicitKind: 'property' });

      expect(screen.getByTestId('account-kind-field')).toHaveTextContent('Майно');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  describe('Save', () => {
    it('creates the property through the one implicit-account write, then goes back', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fill(screen, 'Name', 'Apartment');
      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledTimes(1);
      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'property',
        expect.objectContaining({
          name: 'Apartment',
          type: 'property_item',
          currency: 'UAH',
          color: null,
          metadata: {
            category: 'real_estate',
            lots: [{ day: expect.any(Number), quantityDelta: '1', costMinorUnits: 500_000 }],
          },
          firstPricePoint: { day: expect.any(Number), price: '5000.00' },
        }),
      );
      expect(createImplicitHoldingMock.mock.calls[0][1]).not.toHaveProperty('accountId');
      expect(createMock).not.toHaveBeenCalled();
      expect(setIconMock).not.toHaveBeenCalled();
      expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: false, metals: true });
      expect(mockRunLoanAutoLink).not.toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('creates the loan under the debt kind and runs the loan auto-link', async () => {
      const screen = await renderImplicit({ implicitKind: 'debt' });

      await fill(screen, 'Name', 'Car loan');
      await fill(screen, 'Principal', '500000');
      await pickDate(screen, 'Start date', 2026, 1, 1);
      await fill(screen, 'Annual rate', '12');
      await fill(screen, 'Term', '24');
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledTimes(1);
      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'debt',
        expect.objectContaining({ name: 'Car loan', type: 'loan' }),
      );
      expect(createMock).not.toHaveBeenCalled();
      expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('hands the picked icon to the one implicit write, with no second write', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fill(screen, 'Name', 'Apartment');
      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByLabelText('Change Icon'));
      await fireEvent.press(screen.getByLabelText('Choose icon giftcard'));
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledTimes(1);
      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'property',
        expect.objectContaining({ icon: 'giftcard' }),
      );
      expect(setIconMock).not.toHaveBeenCalled();
    });

    it('a failed Save then a retry sends the whole implicit create again and never a second icon write', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      createImplicitHoldingMock.mockRejectedValueOnce(new Error('disk full'));
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fill(screen, 'Name', 'Apartment');
      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByLabelText('Change Icon'));
      await fireEvent.press(screen.getByLabelText('Choose icon giftcard'));
      await fireEvent.press(screen.getByText('Save'));
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledTimes(2);
      expect(createImplicitHoldingMock).toHaveBeenLastCalledWith(
        'property',
        expect.objectContaining({ icon: 'giftcard' }),
      );
      expect(setIconMock).not.toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      alertSpy.mockRestore();
    });

    it('blocks a nameless Save, scrolling to the name', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).not.toHaveBeenCalled();
      expect(scrollToField).toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('scrolls the mounted name field into view with the live scroll geometry on a nameless Save', async () => {
      (useHeaderInset as jest.Mock).mockReturnValue(96);
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fireEvent(screen.getByTestId('screen-scroll-view'), 'contentSizeChange', 0, 640);
      (scrollToField as jest.Mock).mockClear();
      await fireEvent.press(screen.getByText('Save'));

      expect(scrollToField).toHaveBeenCalledTimes(1);
      const [scrollableRef, fieldRef, geometry, onSettled] = (scrollToField as jest.Mock).mock
        .calls[0];
      expect(scrollableRef).toEqual({ current: null });
      expect(fieldRef.current).not.toBeNull();
      expect(geometry).toEqual({ currentOffset: 0, headerInset: 96, contentHeight: 640 });
      expect(onSettled).toEqual(expect.any(Function));
    });

    it('keeps the form open and says so when the write fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      createImplicitHoldingMock.mockRejectedValueOnce(new Error('disk full'));
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fill(screen, 'Name', 'Apartment');
      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByText('Save'));

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(mockRefreshMarketData).not.toHaveBeenCalled();
      expect(setIconMock).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('the identity carried from the account form', () => {
    const draft = { name: 'Flat', icon: 'giftcard', color: entityColors.violet };

    it('seeds the name, icon and color', async () => {
      const screen = await renderImplicit({ implicitKind: 'property', draft });

      expect(screen.getByLabelText('Name').props.value).toBe('Flat');
      expect(screen.getByLabelText('Icon giftcard')).toBeTruthy();
      expect(screen.getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);
    });

    it('saves the seeded identity', async () => {
      const screen = await renderImplicit({ implicitKind: 'property', draft });

      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'property',
        expect.objectContaining({ name: 'Flat', color: entityColors.violet, icon: 'giftcard' }),
      );
      expect(setIconMock).not.toHaveBeenCalled();
    });

    it('keeps the type default icon and color when the draft carries none', async () => {
      const screen = await renderImplicit({
        implicitKind: 'property',
        draft: { name: 'Flat', icon: null, color: null },
      });

      expect(screen.getByLabelText('Icon house.fill')).toBeTruthy();

      await fill(screen, 'Cost', '5000');
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'property',
        expect.objectContaining({ name: 'Flat', color: null, icon: null }),
      );
      expect(setIconMock).not.toHaveBeenCalled();
    });

    it('seeds once: a later param change keeps what the user typed', async () => {
      const screen = await renderImplicit({ implicitKind: 'property', draft });

      await fill(screen, 'Name', 'My own flat');
      await screen.rerender(
        <HoldingFormScreen
          navigation={navigationProp(navigation)}
          route={routeFor({ implicitKind: 'debt', draft })}
        />,
      );

      expect(screen.getByLabelText('Name').props.value).toBe('My own flat');
    });
  });

  describe('switching the kind', () => {
    const kindSheetModal = spyOnModalAnimationPerTest('account-kind-field-sheet-modal');

    // The sheet is still closing here, so the kind field is what tells the user
    // the tap landed; left on the old kind the form looks frozen.
    it.each([
      ['bank', 'Bank'],
      ['cash', 'Cash'],
      ['crypto', 'Crypto'],
      ['metals', 'Precious metals'],
      ['broker', 'Broker'],
    ] as const)(
      'shows %s on the kind field at once, before the sheet has finished closing',
      async (kind, label) => {
        const screen = await renderImplicit({ implicitKind: 'property' });

        await fireEvent.press(screen.getByTestId('account-kind-field'));
        await fireEvent.press(screen.getByTestId(`account-kind-field-option-${kind}`));

        expect(screen.getByTestId('account-kind-field')).toHaveTextContent(label);
        expect(navigation.replace).not.toHaveBeenCalled();
      },
    );

    // The fade is only a wait for a pick that leaves the form (the replace runs
    // once the sheet is gone), so a pick that creates an account closes with
    // none; the other implicit kind stays in this form and keeps it.
    it.each([
      ['bank', 'none'],
      ['cash', 'none'],
      ['crypto', 'none'],
      ['metals', 'none'],
      ['broker', 'none'],
      ['debt', 'fade'],
    ] as const)('closes the kind sheet for %s with animation "%s"', async (kind, animation) => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fireEvent.press(screen.getByTestId('account-kind-field'));
      await fireEvent.press(screen.getByTestId(`account-kind-field-option-${kind}`));

      expect(kindSheetModal.lastHiddenAnimation()).toBe(animation);
    });

    it('closes the kind sheet for the other implicit kind with a fade from the loan form too', async () => {
      const screen = await renderImplicit({ implicitKind: 'debt' });

      await fireEvent.press(screen.getByTestId('account-kind-field'));
      await fireEvent.press(screen.getByTestId('account-kind-field-option-property'));

      expect(kindSheetModal.lastHiddenAnimation()).toBe('fade');
    });

    it('replaces the screen with the account form on a kind that creates an account', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fill(screen, 'Name', 'Flat');
      await pickKind(screen, 'bank');

      expect(navigation.replace).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('AccountForm', {
        initialKind: 'bank',
        draft: { name: 'Flat', icon: null, color: null },
      });
      expect(navigation.setParams).not.toHaveBeenCalled();
    });

    it('waits for the kind sheet to finish closing before replacing the screen', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await fireEvent.press(screen.getByTestId('account-kind-field'));
      const sheet = screen.getByTestId('account-kind-field-sheet-modal');
      await fireEvent.press(screen.getByTestId('account-kind-field-option-bank'));

      // Replacing now would unmount the screen that owns the sheet mid-close.
      expect(navigation.replace).not.toHaveBeenCalled();

      await act(async () => sheet.props.onDismiss());

      expect(navigation.replace).toHaveBeenCalledTimes(1);
    });

    it('carries the icon and color the user picked back to the account form', async () => {
      const screen = await renderImplicit({ implicitKind: 'debt' });

      await fireEvent.press(screen.getByLabelText('Change Icon'));
      await fireEvent.press(screen.getByLabelText('Choose icon giftcard'));
      await fireEvent.press(screen.getByLabelText('Color violet'));
      await pickKind(screen, 'cash');

      expect(navigation.replace).toHaveBeenCalledWith('AccountForm', {
        initialKind: 'cash',
        draft: { name: '', icon: 'giftcard', color: entityColors.violet },
      });
    });

    it('stays on this form for the other implicit kind, changing only its param', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await pickKind(screen, 'debt');

      expect(navigation.setParams).toHaveBeenCalledTimes(1);
      expect(navigation.setParams).toHaveBeenCalledWith({ implicitKind: 'debt' });
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('turns into the loan form when the kind param becomes debt', async () => {
      const screen = await renderImplicit({ implicitKind: 'property' });

      await screen.rerender(
        <HoldingFormScreen
          navigation={navigationProp(navigation)}
          route={routeFor({ implicitKind: 'debt' })}
        />,
      );

      expect(screen.getByTestId('account-kind-field')).toHaveTextContent('Debt');
      expect(screen.getByLabelText('Principal')).toBeTruthy();
      expect(screen.queryByTestId('property-category-field')).toBeNull();

      await fill(screen, 'Name', 'Car loan');
      await fill(screen, 'Principal', '500000');
      await pickDate(screen, 'Start date', 2026, 1, 1);
      await fill(screen, 'Annual rate', '12');
      await fill(screen, 'Term', '24');
      await fireEvent.press(screen.getByText('Save'));

      expect(createImplicitHoldingMock).toHaveBeenCalledWith(
        'debt',
        expect.objectContaining({ type: 'loan' }),
      );
    });
  });

  it('leaves the account-mode form without a kind field', async () => {
    mockAccountLoaded = true;
    mockAccountKind = 'bank';

    const screen = await renderScreen();

    expect(screen.queryByTestId('account-kind-field')).toBeNull();
  });
});
