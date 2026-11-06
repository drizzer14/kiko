import { Alert } from 'react-native';
import type { ComponentProps, ReactNode } from 'react';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { settingsRepo } from '@kiko/settings';
import { holdCard } from '@kiko/test-support/hold-card';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import type { MarkedChain } from '@kiko/recurring/marked-series';
import type { RecurringSeries } from '@kiko/recurring/detection';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { paneStackModule as mockPaneStackModule } from '@kiko/test-support/mock-pane-stack';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';
import { useRecurringGroups as mockUseRecurringGroups } from '@kiko/test-support/mock-recurring-groups';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

type ButtonProps = {
  variant?: string;
  testID?: string;
  children: ReactNode;
  onPress: () => void;
};

let mockSeries: RecurringSeries[] = [];
let mockMarkedSeries: RecurringSeries[] = [];
let mockWithoutCharges: MarkedChain[] = [];

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => ({
    series: mockSeries,
    markedSeries: mockMarkedSeries,
    withoutCharges: mockWithoutCharges,
    choices: new Map(),
    isLoading: false,
  }),
}));

jest.mock('@kiko/recurring/use-recurring-groups', () => ({
  useRecurringGroups: (shown: RecurringSeries[]) => mockUseRecurringGroups(shown),
}));

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => mockPaneStackModule(() => mockOpenInPane));

// The Button variant maps to a themed fill inside a unistyles `variants` block that the Jest mock
// strips, so "destructive" is proven by recording the props Button receives.
const mockButtonProps = new Map<string, Omit<ButtonProps, 'children' | 'onPress'>>();

jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ children, onPress, testID, ...rest }: ButtonProps) => {
      mockButtonProps.set(String(testID), { testID, ...rest });

      return (
        <Pressable accessibilityRole="button" testID={testID} onPress={onPress}>
          <RNText>{children}</RNText>
        </Pressable>
      );
    },
  };
});

const FIFTEENTH_OF_OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();
const FIRST_OF_MAY = new Date(2026, 4, 1, 8, 0).getTime();
const TENTH_OF_JUNE = new Date(2026, 5, 10, 8, 0).getTime();

const MARKS = [{ currency: 'UAH' as const, amountMinorUnits: 25000, period: 'monthly' as const }];

const seriesWith = (overrides: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id: 'netflix-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: ['netflix-3', 'netflix-2', 'netflix-1'],
  lastChargeTime: FIFTEENTH_OF_OCTOBER,
  lastChargeAmountMinorUnits: 29900,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
  ...overrides,
});

const ACTIVE = seriesWith();
const STOPPED = seriesWith({ isStopped: true, lastChargeTime: FIRST_OF_MAY });
const QUIET = seriesWith({
  isStopped: true,
  lastChargeTime: FIRST_OF_MAY,
  quiet: { since: TENTH_OF_JUNE, holdingName: 'Wallet' },
});
const MARKED = seriesWith({
  recurrence: { kind: 'marked' },
  marks: MARKS,
  markedSpan: { lowest: 10000, highest: 29900 },
});

const ROWS = [
  { kind: 'an active', series: ACTIVE, marked: false },
  { kind: 'a stopped', series: STOPPED, marked: false },
  { kind: 'a quiet', series: QUIET, marked: false },
  { kind: 'a marked', series: MARKED, marked: true },
];

const worldOf = (series: RecurringSeries, marked: boolean): void => {
  mockSeries = marked ? [] : [series];
  mockMarkedSeries = marked ? [series] : [];
  mockWithoutCharges = [];
};

const renderScreen = async () =>
  render(
    <RecurringChargesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
    />,
    { wrapper: GestureRootWrapper },
  );

const CONFIRM_SHEET = 'confirm-sheet';

const rowTestId = (series: RecurringSeries): string => `recurring-series-row-${series.id}`;

const TEXTS = {
  en: {
    title: 'Not a Recurring Charge?',
    message:
      '"Netflix" leaves recurring charges and their totals in every currency, and new charges won\'t bring it back. To bring it back, mark one of its transactions as recurring.',
    confirm: 'Not a recurring charge',
    cancel: 'Cancel',
    deleteWord: /Delete/,
  },
  uk: {
    title: 'Це не регулярний платіж?',
    message:
      '«Netflix» зникне з регулярних платежів і їхніх сум у всіх валютах, і нові списання його не повернуть. Щоб повернути його, позначте одну з його транзакцій як регулярну.',
    confirm: 'Це не регулярний платіж',
    cancel: 'Скасувати',
    deleteWord: /Видалити/,
  },
};

type WriteSpies = { hide: jest.SpyInstance; others: jest.SpyInstance[] };

// Every other function of the repository answers nothing, so a write the row should not make is a
// call a spy sees, and no test reaches a database.
const spyOnWrites = (): WriteSpies => {
  const repository = settingsRepo as Record<string, (...args: unknown[]) => unknown>;
  const others = Object.keys(repository)
    .filter((name) => name !== 'hideRecurringMerchant' && typeof repository[name] === 'function')
    .map((name) => jest.spyOn(repository, name).mockImplementation(async () => undefined));

  return {
    hide: jest.spyOn(settingsRepo, 'hideRecurringMerchant').mockResolvedValue(undefined),
    others,
  };
};

const calledOf = (spies: jest.SpyInstance[]): jest.SpyInstance[] =>
  spies.filter((spy) => spy.mock.calls.length > 0);

beforeEach(async () => {
  mockOpenInPane.mockClear();
  mockButtonProps.clear();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(['en', 'uk'] as const)('RecurringChargesScreen — a long press, in %s', (language) => {
  const texts = TEXTS[language];

  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it.each(ROWS)(
    'opens the confirm on a hold of $kind row, titled and worded as approved',
    async ({ series, marked }) => {
      worldOf(series, marked);

      const { getByTestId, queryByTestId } = await renderScreen();

      expect(queryByTestId(CONFIRM_SHEET)).toBeNull();

      await holdCard();

      const sheet = within(getByTestId(CONFIRM_SHEET));

      expect(sheet.getByText(texts.title)).toBeTruthy();
      expect(sheet.getByText(texts.message)).toBeTruthy();
      expect(sheet.getByText(texts.cancel)).toBeTruthy();
    },
  );

  it.each(ROWS)(
    'labels the confirm button of $kind row as the action, destructive, and never Delete',
    async ({ series, marked }) => {
      worldOf(series, marked);

      const { getByTestId } = await renderScreen();

      await holdCard();

      const sheet = within(getByTestId(CONFIRM_SHEET));

      expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toHaveTextContent(texts.confirm, { exact: true });
      expect(mockButtonProps.get(DELETE_CONFIRM_TEST_ID)?.variant).toBe('destructive');
      expect(sheet.queryByText(texts.deleteWord)).toBeNull();
    },
  );
});

describe('RecurringChargesScreen — the one write of a long press', () => {
  it('calls hideRecurringMerchant with the key, the name and no chain for a detected row, once', async () => {
    const spies = spyOnWrites();

    worldOf(ACTIVE, false);

    const { getByTestId } = await renderScreen();

    await holdCard();

    expect(spies.hide).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(spies.hide).toHaveBeenCalledTimes(1);
    expect(spies.hide).toHaveBeenCalledWith('netflix', 'Netflix', []);
  });

  it('calls it with the marks of the series for a marked row, once', async () => {
    const spies = spyOnWrites();

    worldOf(MARKED, true);

    const { getByTestId } = await renderScreen();

    await holdCard();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(spies.hide).toHaveBeenCalledTimes(1);
    expect(spies.hide).toHaveBeenCalledWith('netflix', 'Netflix', MARKS);
  });

  it.each(ROWS)(
    'runs no other settings write on the confirm of $kind row',
    async ({ series, marked }) => {
      const spies = spyOnWrites();

      worldOf(series, marked);

      const { getByTestId } = await renderScreen();

      await holdCard();
      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(spies.hide).toHaveBeenCalledTimes(1);
      expect(calledOf(spies.others)).toEqual([]);
      expect(spies.others.length).toBeGreaterThan(0);
    },
  );

  it('writes nothing on Cancel, and closes the confirm', async () => {
    const spies = spyOnWrites();

    worldOf(ACTIVE, false);

    const { getByTestId, queryByTestId } = await renderScreen();

    await holdCard();
    await fireEvent.press(within(getByTestId(CONFIRM_SHEET)).getByText('Cancel'));

    expect(spies.hide).not.toHaveBeenCalled();
    expect(calledOf(spies.others)).toEqual([]);
    expect(queryByTestId(CONFIRM_SHEET)).toBeNull();
    expect(getByTestId(rowTestId(ACTIVE))).toBeTruthy();
  });

  it('shows the save alert and keeps the row when the write is rejected', async () => {
    const spies = spyOnWrites();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    spies.hide.mockRejectedValueOnce(new Error('disk full'));
    worldOf(ACTIVE, false);

    const { getByTestId } = await renderScreen();

    await holdCard();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(getByTestId(rowTestId(ACTIVE))).toBeTruthy();
  });

  it('shows no alert when the write is accepted', async () => {
    spyOnWrites();

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    worldOf(ACTIVE, false);

    const { getByTestId } = await renderScreen();

    await holdCard();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('RecurringChargesScreen — the hold beside a tap and Marked, No Charges', () => {
  it.each(ROWS)('still opens the series on a tap of $kind row', async ({ series, marked }) => {
    worldOf(series, marked);

    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId(rowTestId(series)));

    expect(mockOpenInPane).toHaveBeenCalledTimes(1);
    expect(mockOpenInPane.mock.calls[0][1]).toMatchObject({
      seriesId: series.id,
      merchantKey: 'netflix',
    });
  });

  it('gives a row of Marked, No Charges no hold', async () => {
    mockSeries = [];
    mockMarkedSeries = [];
    mockWithoutCharges = [
      { key: 'apple', name: 'Apple', currency: 'UAH', period: 'monthly', marks: MARKS },
    ];

    const { getByText } = await renderScreen();

    expect(getByText(i18n.t('recurringCharges.removeMark'))).toBeTruthy();
    expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
  });

  it('gives a series row a hold, which the Marked, No Charges check above is the twin of', async () => {
    worldOf(ACTIVE, false);
    await renderScreen();

    expect(getByGestureTestId(HOLD_GESTURE_TEST_ID)).toBeTruthy();
  });
});
