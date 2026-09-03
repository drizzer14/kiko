import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { darkTheme } from '../../design-system/theme';
import { holdingsRepo } from '../../repositories/holdings.repo';
import HoldingFormScreen from './holding-form.screen';

const { entityColors } = darkTheme.colors;

jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    create: jest.fn().mockResolvedValue('new-holding-id'),
    setIcon: jest.fn(),
    update: jest.fn(),
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

// The account whose kind constrains the offered holding types. `mock`-prefixed
// so the hoisted jest.mock factory may close over it; each test can reassign it
// before rendering to exercise a different account kind.
let mockAccountKind = 'bank';
// The holding the edit-mode form loads through useLiveQuery. Empty by default
// (create mode); edit-mode tests seed it before rendering.
let mockEditHoldings: unknown[] = [];

jest.mock('../../db/use-live-query', () => ({
  // Key on the subscribed table: the holdings query drives edit-mode hydration,
  // the accounts query drives the allowed-type filter.
  useLiveQuery: (_query: unknown, keys: string[]) =>
    keys[0] === 'holdings'
      ? { data: mockEditHoldings }
      : { data: [{ id: 'acc-1', kind: mockAccountKind }] },
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: { byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const navigation = { goBack: jest.fn(), navigate: jest.fn(), setOptions: jest.fn() } as never;
const route = { params: { accountId: 'acc-1' } } as never;

const createMock = holdingsRepo.create as jest.Mock;
const setIconMock = holdingsRepo.setIcon as jest.Mock;
const updateMock = holdingsRepo.update as jest.Mock;

beforeEach(() => {
  mockAccountKind = 'bank';
  mockEditHoldings = [];
});

const renderScreen = () => render(<HoldingFormScreen navigation={navigation} route={route} />);

// Render the form in EDIT mode against a seeded holding, keyed by its id.
const renderEdit = (holding: Record<string, unknown>) => {
  mockEditHoldings = [holding];
  const editRoute = { params: { accountId: 'acc-1', holdingId: holding.id } } as never;
  return render(<HoldingFormScreen navigation={navigation} route={editRoute} />);
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
  await fireEvent.press(screen.getByText('Term Deposit'));
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

  it('renders a visible text label above every default field', async () => {
    const { getByText } = await renderScreen();

    // Card/cash/crypto/jar path: Name, Type, Currency, Balance are the fields.
    for (const label of ['Name', 'Type', 'Currency', 'Balance']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('does not render the opening Balance input for a term deposit', async () => {
    const screen = await renderScreen();

    // Card/cash/crypto/jar show the Balance input.
    expect(screen.getByLabelText('Balance')).toBeTruthy();

    await fireEvent.press(screen.getByText('Term Deposit'));

    // A deposit's value derives from its contributions, not an opening balance,
    // so the Balance input is dropped to avoid a dead, misleading field.
    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('renders a visible text label above every term-deposit field', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Term Deposit'));

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

    await fireEvent.press(screen.getByText('Term Deposit'));
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

    await fireEvent.press(screen.getByText('Term Deposit'));
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

    await fireEvent.press(screen.getByText('Term Deposit'));
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

    await fireEvent.press(screen.getByText('Term Deposit'));
    await fill(screen, 'Name', 'My deposit');
    await fill(screen, 'Annual Rate %', '12');
    await fill(screen, 'Term (Months)', '12');

    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).not.toHaveBeenCalled();
  });

  it('removes a contribution row via its remove control', async () => {
    const screen = await renderScreen();

    await fireEvent.press(screen.getByText('Term Deposit'));
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

    await fireEvent.press(screen.getByText('Term Deposit'));
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
  });

  it('sets the picked icon on the new holding using the returned id', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My card');
    await fireEvent.press(screen.getByLabelText('Change Icon'));
    await fireEvent.press(screen.getByLabelText('Choose icon banknote'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalled();
    expect(setIconMock).toHaveBeenCalledWith('new-holding-id', 'banknote');
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('does not set an icon when none is picked', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My card');
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock).toHaveBeenCalled();
    expect(setIconMock).not.toHaveBeenCalled();
  });
});

describe('HoldingFormScreen icon follows type until dirty', () => {
  it("shows the default type's icon before any pick (card -> creditcard)", async () => {
    const screen = await renderScreen();

    expect(screen.getByLabelText('Icon creditcard')).toBeTruthy();
  });

  it('re-derives the icon to the newly selected type default while not dirty', async () => {
    const screen = await renderScreen();

    // card default is creditcard; switching to bond swaps the shown default to
    // the bond glyph, because the icon has not been manually picked (not dirty).
    await fireEvent.press(screen.getByText('Bond'));

    expect(screen.getByLabelText('Icon doc.text')).toBeTruthy();
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
    expect(screen.queryByLabelText('Icon doc.text')).toBeNull();
  });
});

describe('HoldingFormScreen type chips are constrained by the account kind', () => {
  it('forbids cash and crypto_asset holding types on a bank account', async () => {
    mockAccountKind = 'bank';

    const screen = await renderScreen();

    expect(screen.getByText('Card')).toBeTruthy();
    expect(screen.getByText('Jar')).toBeTruthy();
    expect(screen.queryByText('Cash')).toBeNull();
    expect(screen.queryByText('Crypto Asset')).toBeNull();
  });

  it('offers only the crypto_asset holding type on a crypto account', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();

    expect(screen.getByText('Crypto Asset')).toBeTruthy();
    expect(screen.queryByText('Card')).toBeNull();
    expect(screen.queryByText('Term Deposit')).toBeNull();
  });

  it('snaps an out-of-range default type into the account kind allowed set', async () => {
    mockAccountKind = 'crypto';

    const screen = await renderScreen();

    // The default type is `card`, which a crypto account forbids, so the form
    // resets to the first allowed type (crypto_asset) — proven by the shown
    // default icon following to the crypto_asset glyph.
    expect(screen.getByLabelText('Icon bitcoinsign.circle')).toBeTruthy();
  });
});

describe('HoldingFormScreen color follows type until dirty', () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it("selects the default type's color before any pick (card -> white)", async () => {
    const screen = await renderScreen();

    expect(screen.getByLabelText('Color white').props.accessibilityState.selected).toBe(true);
  });

  it('re-derives the color to the newly selected type default while not dirty', async () => {
    const screen = await renderScreen();

    // card default is white; switching to bond swaps the selected default swatch
    // to green, because the color has not been manually picked (not dirty).
    await fireEvent.press(screen.getByText('Bond'));

    expect(screen.getByLabelText('Color green').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Color white').props.accessibilityState.selected).toBe(false);
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
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My card');
    await fireEvent.press(screen.getByLabelText('Color violet'));
    await fireEvent.press(screen.getByText('Save'));

    expect(createMock.mock.calls[0][0].color).toBe(entityColors.violet);
  });

  it('persists a null color on create when the user never picks one', async () => {
    const screen = await renderScreen();

    await fill(screen, 'Name', 'My card');
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

  it('shows type and currency read-only (disabled) so neither can change', async () => {
    const { getByText } = await renderEdit(cardHolding);

    expect(getByText('Card').parent?.props.accessibilityState.disabled).toBe(true);
    expect(getByText('UAH').parent?.props.accessibilityState.disabled).toBe(true);
  });

  it('saves a simple type through update with the edited name, color, and balance', async () => {
    const screen = await renderEdit(cardHolding);

    await fill(screen, 'Name', 'Renamed card');
    await fill(screen, 'Balance', '300');
    await fireEvent.press(screen.getByLabelText('Color teal'));
    await fireEvent.press(screen.getByText('Save'));

    expect(updateMock).toHaveBeenCalledWith('h-1', {
      name: 'Renamed card',
      color: entityColors.teal,
      balanceMinorUnits: 300_00,
    });
    expect(setIconMock).toHaveBeenCalledWith('h-1', 'banknote');
    expect(createMock).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
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
    const screen = await renderEdit(syncedCardHolding);

    // A synced holding's balance is owned by the sync, so the manual balance
    // field is not offered in edit mode.
    expect(screen.queryByLabelText('Balance')).toBeNull();
  });

  it('does not write balanceMinorUnits when editing a synced holding', async () => {
    const screen = await renderEdit(syncedCardHolding);

    await fill(screen, 'Name', 'Renamed monobank');
    await fireEvent.press(screen.getByText('Save'));

    const patch = updateMock.mock.calls[0][1];
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

    const patch = updateMock.mock.calls[0][1];
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

    const patch = updateMock.mock.calls[0][1];
    expect(patch.metadata.couponPct).toBe(11);
    expect(patch.metadata.quantity).toBe(10);
    expect(patch.metadata.bondKind).toBe('corporate');
    expect(patch.balanceMinorUnits).toBeUndefined();
  });
});
