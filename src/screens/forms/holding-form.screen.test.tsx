import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

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

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    create: jest.fn().mockResolvedValue('new-holding-id'),
    setIcon: jest.fn(),
    update: jest.fn(),
    updateWithBalanceDelta: jest.fn(),
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

// The account whose kind constrains the offered holding types. `mock`-prefixed
// so the hoisted jest.mock factory may close over it; each test can reassign it
// before rendering to exercise a different account kind.
let mockAccountKind = 'bank';
// The account's live sync connection. A holding only counts as synced while its
// account is still connected: a disconnect KEEPS the holding's sync key (so a
// reconnect re-adopts the row), so the institution is what decides.
let mockAccountInstitution: string | null = null;
// The holding the edit-mode form loads through useLiveQuery. Empty by default
// (create mode); edit-mode tests seed it before rendering.
let mockEditHoldings: unknown[] = [];

jest.mock('../../db/use-live-query', () => ({
  // Key on the subscribed table: the holdings query drives edit-mode hydration,
  // the accounts query drives the allowed-type filter and the sync gate.
  useLiveQuery: (_query: unknown, keys: string[]) =>
    keys[0] === 'holdings'
      ? { data: mockEditHoldings }
      : { data: [{ id: 'acc-1', kind: mockAccountKind, institution: mockAccountInstitution }] },
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: { byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

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

beforeEach(() => {
  mockAccountKind = 'bank';
  mockAccountInstitution = null;
  mockEditHoldings = [];
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

const fillBondFields = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByText('Bond'));
  await fill(screen, 'Name', 'My bond');
  await fill(screen, 'Quantity', '10');
  await fill(screen, 'Face Value', '1000');
  await fill(screen, 'Coupon %', '9');
  await pickDate(screen, 'Purchase Date', 2026, 1, 1);
  await pickDate(screen, 'Maturity Date', 2028, 1, 1);
};

const fillTermDepositFields = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByText('Deposit'));
  await fill(screen, 'Name', 'My deposit');
  await fill(screen, 'Contribution 1 Amount', '1000');
  await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
  await fill(screen, 'Annual Rate %', '12');
  await fill(screen, 'Term (Months)', '12');
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

  it('renders a visible text label above every term-deposit field', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));

    // The repeatable contributions list starts with one row.
    expect(screen.getByLabelText('Contribution 1 Amount')).toBeTruthy();
    expect(screen.getByLabelText('Contribution 1 Date')).toBeTruthy();
    expect(screen.getByText('Add contribution')).toBeTruthy();

    for (const label of ['Annual Rate %', 'Term (Months)', 'Recapitalization', 'Compounding']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders a visible text label above every bond field', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));

    for (const label of [
      'Quantity',
      'Face Value',
      'Coupon %',
      'Purchase Date',
      'Maturity Date',
      'Bond Kind',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('saves a term_deposit with a single contribution in its metadata', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

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

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);

    await fireEvent.press(screen.getByText('Add contribution'));

    await fill(screen, 'Contribution 2 Amount', '500');
    await pickDate(screen, 'Contribution 2 Date', 2026, 2, 1);
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.contributions).toHaveLength(2);
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
      { amountMinorUnits: 50_000, date: localDay(2026, 2, 1) },
    ]);
  });

  it('persists only the filled row when a blank contribution row is left empty', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Contribution 1 Amount', '1000');
    await pickDate(screen, 'Contribution 1 Date', 2026, 1, 1);
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    // Add a second row but leave it blank.
    await fireEvent.press(screen.getByText('Add contribution'));

    await fireEvent.press(screen.getByText('Save'));

    const metadata = metadataOfFirstCreate();
    expect(metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
    ]);
  });

  it('does not save a deposit when no contribution row is valid', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
  });

  it('removes a contribution row via its remove control', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fireEvent.press(screen.getByText('Add contribution'));

    expect(screen.getByLabelText('Contribution 2 Amount')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Remove contribution 2'));

    expect(screen.queryByLabelText('Contribution 2 Amount')).toBeNull();
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

    await fireEvent.press(screen.getByText('Quarterly'));

    await fireEvent.press(screen.getByText('Save'));

    expect(metadataOfFirstCreate().couponFrequency).toBe('quarterly');
  });
});

describe('HoldingFormScreen save validation', () => {
  beforeEach(() => {
    createMock.mockClear();
    setIconMock.mockClear();
  });

  it('disables Save for a term deposit missing its contribution, rate, and term', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Deposit'));
    await fill(screen, 'Name', 'My deposit');

    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('enables Save once the term deposit has a valid contribution, rate, and term', async () => {
    const screen = await renderScreen();

    await fillTermDepositFields(screen);

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('disables Save for a bond missing its numeric fields and dates', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');

    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('disables Save when the bond maturity is not after its purchase date', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Bond'));
    await fill(screen, 'Name', 'My bond');
    await fill(screen, 'Quantity', '10');
    await fill(screen, 'Face Value', '1000');
    await fill(screen, 'Coupon %', '9');
    await pickDate(screen, 'Purchase Date', 2026, 1, 1);
    await pickDate(screen, 'Maturity Date', 2026, 1, 1);

    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('enables Save once the bond fields and dates are valid', async () => {
    const screen = await renderScreen();

    await fillBondFields(screen);

    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('disables Save when the holding name is blank', async () => {
    const { getByText } = await renderScreen();

    expect(getByText('Save')).toBeDisabled();
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
      expect.objectContaining({ accountId: 'acc-1', currency: 'UAH', balanceMinorUnits: 500_00 }),
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
    await fireEvent.press(screen.getByText('Bond'));

    expect(screen.getByLabelText('Icon receipt')).toBeTruthy();
  });

  it('keeps a manually picked icon when the type changes afterwards (dirty)', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText('Choose icon basket'));

    expect(screen.getByLabelText('Icon basket')).toBeTruthy();

    // Once picked, the icon is dirty: switching type no longer moves it off the
    // user's choice.
    await fireEvent.press(screen.getByText('Bond'));

    expect(screen.getByLabelText('Icon basket')).toBeTruthy();
    expect(screen.queryByLabelText('Icon receipt')).toBeNull();
  });
});

describe('HoldingFormScreen type chips are constrained by the account kind', () => {
  it('offers only the manually-creatable bank types (term_deposit, bond), excluding sync-only card and jar', async () => {
    mockAccountKind = 'bank';

    const screen = await renderScreen();

    // Monobank owns card + jar (its sync creates them), so the manual create form
    // drops both; a bank create offers only term_deposit and bond. Cash and
    // crypto_asset are forbidden under a bank regardless.
    expect(screen.getByText('Deposit')).toBeTruthy();
    expect(screen.getByText('Bond')).toBeTruthy();
    expect(screen.queryByText('Card')).toBeNull();
    expect(screen.queryByText('Jar')).toBeNull();
    expect(screen.queryByText('Cash')).toBeNull();
    expect(screen.queryByText('Crypto Asset')).toBeNull();
  });

  it('offers only the crypto_asset holding type on a crypto account', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();

    expect(screen.getByText('Crypto Asset')).toBeTruthy();
    expect(screen.queryByText('Card')).toBeNull();
    expect(screen.queryByText('Deposit')).toBeNull();
  });

  it('snaps an out-of-range default type into the account kind allowed set', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();

    // The default type is `card`, which a crypto account forbids, so the form
    // resets to the first allowed type (crypto_asset) — proven by the shown
    // default icon following to the crypto_asset glyph.
    expect(screen.getByLabelText('Icon bitcoinsign')).toBeTruthy();
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
    await fireEvent.press(screen.getByText('Bond'));

    expect(screen.getByLabelText('Color green').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Color blue').props.accessibilityState.selected).toBe(false);
  });

  it('keeps a manually picked color when the type changes afterwards (dirty)', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByLabelText('Color violet'));

    expect(screen.getByLabelText('Color violet').props.accessibilityState.selected).toBe(true);

    // Once picked, the color is dirty: switching type no longer moves it off the
    // user's choice onto the bond default (green).
    await fireEvent.press(screen.getByText('Bond'));

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
    const { getByText } = await renderEdit(cardHolding);

    // A synced card's type is dropped from the CREATE options, but edit mode uses
    // the full set — so the Card chip still renders (read-only) rather than
    // crashing on a type that is no longer manually creatable.
    expect(getByText('Card').parent?.props.accessibilityState.disabled).toBe(true);
    expect(getByText('UAH').parent?.props.accessibilityState.disabled).toBe(true);
  });

  it('renders an existing synced jar holding read-only, though jar is not manually creatable', async () => {
    const { getByText } = await renderEdit({
      id: 'h-9',
      name: 'Coffee jar',
      type: 'jar',
      currency: 'UAH',
      balanceMinorUnits: 5_000,
      icon: null,
      color: null,
    });

    // Same as the card case: jar is sync-only (excluded from create), but edit
    // mode's full set still shows the Jar chip read-only rather than crashing.
    expect(getByText('Jar').parent?.props.accessibilityState.disabled).toBe(true);
  });

  it('saves a simple type through update with the edited name, color, and balance', async () => {
    const screen = await renderEdit(cardHolding);

    await fill(screen, 'Name', 'Renamed card');
    await fill(screen, 'Balance', '300');
    await fireEvent.press(screen.getByLabelText('Color teal'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateDeltaMock).toHaveBeenCalledWith(
      'h-1',
      { name: 'Renamed card', color: entityColors.teal, balanceMinorUnits: 300_00 },
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
      expect.objectContaining({ balanceMinorUnits: 500_00 }),
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

  it('does not write balanceMinorUnits when editing a synced holding', async () => {
    mockAccountInstitution = 'monobank';
    const screen = await renderEdit(syncedCardHolding);

    await fill(screen, 'Name', 'Renamed monobank');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.name).toBe('Renamed monobank');
    // The synced balance must stay untouched until the next sync.
    expect(patch.balanceMinorUnits).toBeUndefined();
  });

  it('seeds a term deposit and saves its edited metadata through update', async () => {
    const screen = await renderEdit(depositHolding);

    // The stored contribution/rate/term seed the fields.
    expect(screen.getByDisplayValue('1 000')).toBeTruthy();
    expect(screen.getByDisplayValue('12')).toBeTruthy();
    expect(screen.getByDisplayValue('24')).toBeTruthy();

    await fill(screen, 'Annual Rate %', '15');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateDeltaMock.mock.calls[0][1];
    expect(patch.name).toBe('My deposit');
    expect(patch.metadata.annualRatePct).toBe(15);
    expect(patch.metadata.termMonths).toBe(24);
    expect(patch.metadata.contributions).toEqual([
      { amountMinorUnits: 100_000, date: localDay(2026, 1, 1) },
    ]);
    // A deposit's value derives from metadata, so no balance is written.
    expect(patch.balanceMinorUnits).toBeUndefined();
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
    expect(patch.balanceMinorUnits).toBeUndefined();
  });

  it('resolves a stored empty-string color to a real swatch, not blank', async () => {
    const { getByLabelText } = await renderEdit({ ...cardHolding, color: '' });

    expect(selectedSwatchHex(getByLabelText)).toMatch(HEX);
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

    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Облігація'));

    expect(getByText('Кількість')).toBeTruthy();
    expect(getByText('Номінальна вартість')).toBeTruthy();
    expect(getByText('Купон %')).toBeTruthy();
    expect(getByText('Дата придбання')).toBeTruthy();
    expect(getByText('Дата погашення')).toBeTruthy();
    expect(getByText('Тип облігації')).toBeTruthy();
    expect(getByText('Державна')).toBeTruthy();
  });
});
