import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { formatMoney } from '@kiko/currency/format';
import { chargesAt } from '@kiko/test-support/marked-series-worlds';
import { ledgerOf, monthly, chargeOf, at } from '@kiko/test-support/recurring-ledger';
import { hookStateOf, type MarkedNames } from '@kiko/test-support/marked-series-hook-result';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';
import { useRecurringGroups as mockUseRecurringGroups } from '@kiko/test-support/mock-recurring-groups';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

type HookState = ReturnType<typeof hookStateOf>;

let mockResult: HookState;

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockResult,
}));

jest.mock('@kiko/recurring/use-recurring-groups', () => ({
  useRecurringGroups: (shown: Parameters<typeof mockUseRecurringGroups>[0]) =>
    mockUseRecurringGroups(shown),
}));

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => mockOpenInPane,
  useDetailPaneRoute: () => null,
}));

const renderScreen = async (state: HookState) => {
  mockResult = state;

  return render(
    <RecurringChargesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
    />,
  );
};

const ROW = /^recurring-series-row-/;
const EMPTY = 'recurring-charges-empty';

const markedEmptyHeading = (): string => i18n.t('recurringCharges.markedEmptyHeading');
const markedEmptyMessage = (): string => i18n.t('recurringCharges.markedEmptyMessage');
const removeMarkText = (): string => i18n.t('recurringCharges.removeMark');
const rowTestId = (id: string): string => `recurring-series-row-${id}`;

const idOf = (state: HookState, name: string): string => {
  const found = [...state.series, ...state.markedSeries].find((series) => series.name === name);

  if (found === undefined) {
    throw new Error(`the world holds no series of ${name}`);
  }

  return found.id;
};

const shownOrder = (getAllByTestId: (matcher: RegExp) => { props: { testID?: string } }[]) =>
  getAllByTestId(/^(recurring-series-row-|recurring-charges-heading-)/).map(
    (node) => node.props.testID,
  );

// A marked and a detected series each in active and in stopped, all monthly.
const mixedLedger = () =>
  ledgerOf([
    ...monthly(10, 5, 99, { prefix: 'apple', description: 'Apple' }),
    ...monthly(6, 12, 9, { prefix: 'spotify', description: 'Spotify' }),
    ...monthly(4, 15, 199, { prefix: 'gym', description: 'Gym', newest: [2026, 6] }),
    ...monthly(6, 9, 150, { prefix: 'dropbox', description: 'Dropbox', newest: [2026, 7] }),
  ]);

const MIXED_MARKED: MarkedNames[] = [
  ['Apple', ['monthly', 99]],
  ['Gym', ['monthly', 199]],
];

// Apple's four stored amounts in three currency and amount pieces, and ATB's one.
const GHOSTS: MarkedNames[] = [
  ['Apple', ['monthly', 99], ['yearly', 499], ['everyThreeMonths', 5, 'USD']],
  ['ATB', ['weekly', 1]],
];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  mockOpenInPane.mockClear();
});

describe('RecurringChargesScreen — marked series', () => {
  it('lists a marked series in active or stopped by its dates, among the detected ones', async () => {
    const state = hookStateOf(mixedLedger(), MIXED_MARKED);
    const { getAllByTestId } = await renderScreen(state);

    expect(state.markedSeries.map(({ name, isStopped }) => [name, isStopped])).toEqual([
      ['Apple', false],
      ['Gym', true],
    ]);
    expect(state.series.map(({ name, isStopped }) => [name, isStopped]).sort()).toEqual([
      ['Dropbox', true],
      ['Spotify', false],
    ]);
    expect(shownOrder(getAllByTestId)).toEqual([
      rowTestId(idOf(state, 'Spotify')),
      rowTestId(idOf(state, 'Apple')),
      rowTestId(idOf(state, 'Dropbox')),
      rowTestId(idOf(state, 'Gym')),
    ]);
  });

  it('shows its recurrence line and the amount of the last real charge, never a stored amount', async () => {
    const ledger = ledgerOf(
      chargesAt('bill', [
        [2026, 8, 2, 250],
        [2026, 9, 19, 250],
        [2026, 10, 28, 260],
      ]),
    );
    const state = hookStateOf(ledger, [['Netflix', ['monthly', 250]]]);
    const { getByTestId, getByText, queryByText } = await renderScreen(state);
    const [series] = state.markedSeries;

    expect(getByTestId(rowTestId(series.id))).toBeTruthy();
    expect(getByText(i18n.t('recurringCharges.marked.monthly'))).toBeTruthy();
    expect(
      getByText(i18n.t('recurringCharges.lastCharge', { date: formatDate(series.lastChargeTime) })),
    ).toBeTruthy();
    expect(getByText(formatMoney(Money.of('UAH', 26000)))).toBeTruthy();
    expect(queryByText(formatMoney(Money.of('UAH', 25000)))).toBeNull();
  });

  describe('a tap', () => {
    const RISE = ledgerOf([
      ...monthly(8, 7, (index) => (index < 3 ? 130 : 100), { prefix: 'rise', description: 'Rise' }),
      chargeOf('rise-feb', at(2026, 2, 7), 115, { description: 'Rise' }),
    ]);

    it('passes the lowest of its marks on a marked series, whatever their order', async () => {
      const state = hookStateOf(RISE, [['Rise', ['monthly', 130], ['monthly', 100]]]);
      const [series] = state.markedSeries;
      const reversed = { ...series, marks: [...(series.marks ?? [])].reverse() };
      const { getByTestId } = await renderScreen({ ...state, markedSeries: [reversed] });

      expect(series.marks).toHaveLength(2);
      expect(reversed.marks[0].amountMinorUnits).toBe(13000);

      await fireEvent.press(getByTestId(rowTestId(series.id)));

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('RecurringSeries', {
        seriesId: series.id,
        merchantKey: 'rise',
        currency: 'UAH',
        period: 'monthly',
        name: 'Rise',
        markedAmountMinorUnits: 10000,
      });
    });

    it('passes no such key on a detected series beside a marked one', async () => {
      const state = hookStateOf(mixedLedger(), MIXED_MARKED);
      const { getByTestId } = await renderScreen(state);

      await fireEvent.press(getByTestId(rowTestId(idOf(state, 'Spotify'))));

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane.mock.calls[0][1]).toEqual({
        seriesId: idOf(state, 'Spotify'),
        merchantKey: 'spotify',
        currency: 'UAH',
        period: 'monthly',
        name: 'Spotify',
      });
      expect(mockOpenInPane.mock.calls[0][1]).not.toHaveProperty('markedAmountMinorUnits');
    });
  });
});

describe('RecurringChargesScreen — Marked, No Charges', () => {
  it('lists each piece with its message, its marked line and a remove button, and shows no amount', async () => {
    const netflix = ledgerOf(monthly(6, 3, 250, { prefix: 'netflix' }));
    const state = hookStateOf(netflix, GHOSTS);
    const { getAllByText, getByText, queryByText } = await renderScreen(state);

    expect(state.withoutCharges).toHaveLength(4);
    expect(getAllByText(markedEmptyHeading())).toHaveLength(1);
    expect(getAllByText(markedEmptyMessage())).toHaveLength(4);
    expect(getAllByText(removeMarkText())).toHaveLength(4);
    expect(getAllByText('Apple')).toHaveLength(3);
    expect(getAllByText('ATB')).toHaveLength(1);
    // The twin: a real series shows its last charge, so the matcher does find an amount.
    expect(getByText(formatMoney(Money.of('UAH', 25000)))).toBeTruthy();

    for (const { currency, marks } of state.withoutCharges) {
      for (const { amountMinorUnits } of marks) {
        expect(queryByText(formatMoney(Money.of(currency, amountMinorUnits)))).toBeNull();
      }
    }
  });

  it('removes the marks of the piece whose button is tapped, under its key', async () => {
    const removeSpy = jest.spyOn(settingsRepo, 'removeRecurringMarks').mockResolvedValue(undefined);
    const state = hookStateOf(ledgerOf([]), GHOSTS);
    const { getAllByText } = await renderScreen(state);

    expect(removeSpy).not.toHaveBeenCalled();

    await fireEvent.press(getAllByText(removeMarkText())[2]);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('apple', state.withoutCharges[2].marks);
    expect(state.withoutCharges[2].currency).toBe('USD');
    removeSpy.mockRestore();
  });

  it('shows the empty state and the section together when only those are there', async () => {
    const { getByTestId, getAllByText } = await renderScreen(hookStateOf(ledgerOf([]), GHOSTS));

    expect(getByTestId(EMPTY)).toHaveTextContent(i18n.t('recurringCharges.emptyTitle'), {
      exact: false,
    });
    expect(getAllByText(markedEmptyHeading())).toHaveLength(1);
    expect(getAllByText(markedEmptyMessage())).toHaveLength(4);
  });

  it('shows no empty state once a marked series stands beside the section', async () => {
    const netflix = ledgerOf(monthly(6, 3, 250, { prefix: 'netflix' }));
    const state = hookStateOf(netflix, [['Netflix', ['monthly', 250]], ...GHOSTS]);
    const { queryByTestId, getAllByText, getByTestId } = await renderScreen(state);

    expect(getByTestId(rowTestId(idOf(state, 'Netflix')))).toBeTruthy();
    expect(getAllByText(markedEmptyHeading())).toHaveLength(1);
    expect(queryByTestId(EMPTY)).toBeNull();
  });

  it('puts the section after the series and before the hidden one', async () => {
    // One series, so the ten rows the list draws first reach the hidden section.
    const state = hookStateOf(
      ledgerOf(monthly(6, 3, 250, { prefix: 'netflix' })),
      [['Ghost', ['yearly', 50]]],
      new Map([['zeta', { name: 'Zeta', hidden: true as const }]]),
    );
    const { getAllByText } = await renderScreen(state);
    const headings = [markedEmptyHeading(), i18n.t('recurringCharges.hiddenHeading')];

    expect(
      getAllByText(new RegExp(`^(${headings.join('|')})$`)).map((node) => node.props.children),
    ).toEqual(headings);
  });
});

describe('RecurringChargesScreen — a hide beside marks', () => {
  const APPLE = ledgerOf([
    ...monthly(10, 5, 99, { prefix: 'cheap', description: 'Apple' }),
    ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
  ]);
  const HIDDEN_APPLE = new Map([['apple', { name: 'Apple', hidden: true as const }]]);

  it('leaves the marked series listed and hides the detected one under the same key', async () => {
    const shown = hookStateOf(APPLE, [['Apple', ['monthly', 99]]], HIDDEN_APPLE);
    const { getByTestId, queryByTestId, queryAllByTestId } = await renderScreen(shown);
    const [marked] = shown.markedSeries;
    const [detected] = shown.series;

    expect(detected.merchantKey).toBe('apple');
    expect(getByTestId(rowTestId(marked.id))).toBeTruthy();
    expect(queryByTestId(rowTestId(detected.id))).toBeNull();
    expect(queryAllByTestId(ROW)).toHaveLength(1);
    expect(getByTestId('recurring-charges-hidden-apple')).toHaveTextContent('Apple');
  });

  it('lists both when the hide is gone, which the hidden state is the twin of', async () => {
    const shown = hookStateOf(APPLE, [['Apple', ['monthly', 99]]]);
    const { queryAllByTestId, queryByTestId } = await renderScreen(shown);

    expect(queryAllByTestId(ROW)).toHaveLength(2);
    expect(queryByTestId('recurring-charges-hidden-apple')).toBeNull();
  });

  it('lists the chains without a charge of a hidden key', async () => {
    const state = hookStateOf(
      ledgerOf([]),
      [['Ghost', ['yearly', 50]]],
      new Map([['ghost', { name: 'Ghost', hidden: true as const }]]),
    );
    const { getAllByText, getByTestId } = await renderScreen(state);

    expect(getAllByText(markedEmptyMessage())).toHaveLength(1);
    expect(getByTestId('recurring-charges-hidden-ghost')).toBeTruthy();
  });
});
