import type { ComponentProps } from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringChargesScreen from './recurring-charges.screen';

type ScreenProps = ComponentProps<typeof RecurringChargesScreen>;

let mockResult: { series: RecurringSeries[]; isLoading: boolean } = {
  series: [],
  isLoading: false,
};

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockResult,
}));

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => mockOpenInPane,
  useDetailPaneRoute: () => null,
}));

const renderScreen = async (result: typeof mockResult) => {
  mockResult = result;

  return render(
    <RecurringChargesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<ScreenProps['route']>('RecurringCharges')}
    />,
  );
};

const FIFTEENTH_OF_OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();
const TWENTIETH_OF_OCTOBER = new Date(2026, 9, 20, 18, 5).getTime();
const FIRST_OF_MAY = new Date(2026, 4, 1, 8, 0).getTime();
const TENTH_OF_JUNE = new Date(2026, 5, 10, 8, 0).getTime();

const seriesWith = (overrides: Partial<RecurringSeries>): RecurringSeries => ({
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

const rowTestId = (series: RecurringSeries): string => `recurring-series-row-${series.id}`;

const STOPPED_HEADING = 'recurring-charges-heading-stopped';

const amountOf = (series: RecurringSeries): string =>
  formatMoney(Money.of(series.currency, series.lastChargeAmountMinorUnits));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('RecurringChargesScreen — loading and empty', () => {
  it('shows the loading state, not the empty state, while a read is queued', async () => {
    const { getByTestId, queryByTestId, queryByText } = await renderScreen({
      series: [],
      isLoading: true,
    });

    expect(getByTestId('recurring-charges-loading')).toBeTruthy();
    expect(queryByTestId('recurring-charges-empty')).toBeNull();
    expect(queryByText(i18n.t('recurringCharges.emptyTitle'))).toBeNull();
  });

  it('shows the empty state with its title and message when no series was found', async () => {
    const { getByTestId, queryByTestId } = await renderScreen({ series: [], isLoading: false });

    expect(queryByTestId('recurring-charges-loading')).toBeNull();
    expect(getByTestId('recurring-charges-empty')).toHaveTextContent(
      i18n.t('recurringCharges.emptyTitle'),
      { exact: false },
    );
    expect(getByTestId('recurring-charges-empty')).toHaveTextContent(
      i18n.t('recurringCharges.emptyMessage'),
      { exact: false },
    );
    expect(queryByTestId(STOPPED_HEADING)).toBeNull();
  });

  it('shows no empty state once a series is listed', async () => {
    const { getByTestId, queryByTestId } = await renderScreen({
      series: [seriesWith({})],
      isLoading: false,
    });

    expect(getByTestId(rowTestId(seriesWith({})))).toBeTruthy();
    expect(queryByTestId('recurring-charges-empty')).toBeNull();
    expect(queryByTestId('recurring-charges-loading')).toBeNull();
  });
});

describe('RecurringChargesScreen — sections and order', () => {
  const NEWEST_ACTIVE = seriesWith({
    id: 'spotify-1',
    merchantKey: 'spotify',
    name: 'Spotify',
    lastChargeTime: TWENTIETH_OF_OCTOBER,
  });
  const OLDER_ACTIVE = seriesWith({ id: 'netflix-1' });
  const NEWER_STOPPED = seriesWith({
    id: 'gym-1',
    merchantKey: 'gym',
    name: 'Gym',
    isStopped: true,
    lastChargeTime: TENTH_OF_JUNE,
  });
  const OLDER_STOPPED = seriesWith({
    id: 'dropbox-1',
    merchantKey: 'dropbox',
    name: 'Dropbox',
    isStopped: true,
    lastChargeTime: FIRST_OF_MAY,
  });

  const shownOrder = (getAllByTestId: (matcher: RegExp) => { props: { testID?: string } }[]) =>
    getAllByTestId(/^(recurring-series-row-|recurring-charges-heading-)/).map(
      (node) => node.props.testID,
    );

  it('lists the active series newest charge first, then the stopped heading and the stopped series', async () => {
    const { getAllByTestId, getByTestId } = await renderScreen({
      series: [OLDER_STOPPED, OLDER_ACTIVE, NEWER_STOPPED, NEWEST_ACTIVE],
      isLoading: false,
    });

    expect(shownOrder(getAllByTestId)).toEqual([
      rowTestId(NEWEST_ACTIVE),
      rowTestId(OLDER_ACTIVE),
      STOPPED_HEADING,
      rowTestId(NEWER_STOPPED),
      rowTestId(OLDER_STOPPED),
    ]);
    expect(getByTestId(STOPPED_HEADING)).toHaveTextContent(
      i18n.t('recurringCharges.stoppedHeading'),
    );
  });

  it('puts the stopped heading first when every series is stopped', async () => {
    const { getAllByTestId } = await renderScreen({
      series: [OLDER_STOPPED, NEWER_STOPPED],
      isLoading: false,
    });

    expect(shownOrder(getAllByTestId)).toEqual([
      STOPPED_HEADING,
      rowTestId(NEWER_STOPPED),
      rowTestId(OLDER_STOPPED),
    ]);
  });

  it('shows no stopped heading when no series is stopped', async () => {
    const { getAllByTestId, queryByTestId } = await renderScreen({
      series: [OLDER_ACTIVE, NEWEST_ACTIVE],
      isLoading: false,
    });

    expect(shownOrder(getAllByTestId)).toEqual([rowTestId(NEWEST_ACTIVE), rowTestId(OLDER_ACTIVE)]);
    expect(queryByTestId(STOPPED_HEADING)).toBeNull();
  });

  it('orders series with one last-charge time by merchant key, then by series id', async () => {
    const byKeyLast = seriesWith({ id: 'a-3', merchantKey: 'netflix', name: 'Netflix' });
    const byKeyFirst = seriesWith({ id: 'z-1', merchantKey: 'apple', name: 'Apple' });
    const byIdFirst = seriesWith({ id: 'a-1', merchantKey: 'netflix', name: 'Netflix' });
    const { getAllByTestId } = await renderScreen({
      series: [byKeyLast, byIdFirst, byKeyFirst],
      isLoading: false,
    });

    expect(shownOrder(getAllByTestId)).toEqual([
      rowTestId(byKeyFirst),
      rowTestId(byIdFirst),
      rowTestId(byKeyLast),
    ]);
  });
});

describe('RecurringChargesScreen — a tap', () => {
  beforeEach(() => {
    mockOpenInPane.mockClear();
  });

  it('opens the series with every route param, through the pane opener', async () => {
    const dollars = seriesWith({
      id: 'figma-1',
      merchantKey: 'figma',
      name: 'Figma',
      currency: 'USD',
      period: 'yearly',
      recurrence: { kind: 'none' },
    });
    const { getByTestId } = await renderScreen({
      series: [seriesWith({}), dollars],
      isLoading: false,
    });

    expect(mockOpenInPane).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(rowTestId(dollars)));

    expect(mockOpenInPane).toHaveBeenCalledTimes(1);
    expect(mockOpenInPane).toHaveBeenCalledWith('RecurringSeries', {
      seriesId: 'figma-1',
      merchantKey: 'figma',
      currency: 'USD',
      period: 'yearly',
      name: 'Figma',
    });
  });

  it('opens the series of the row tapped, not of another row', async () => {
    const other = seriesWith({ id: 'spotify-1', merchantKey: 'spotify', name: 'Spotify' });
    const { getByTestId } = await renderScreen({
      series: [seriesWith({}), other],
      isLoading: false,
    });

    await fireEvent.press(getByTestId(rowTestId(seriesWith({}))));

    expect(mockOpenInPane).toHaveBeenCalledWith('RecurringSeries', {
      seriesId: 'netflix-1',
      merchantKey: 'netflix',
      currency: 'UAH',
      period: 'monthly',
      name: 'Netflix',
    });
  });
});

describe('RecurringChargesScreen — a row', () => {
  it('shows the name, the recurrence line, the last charge and the amount in its own currency', async () => {
    const dollars = seriesWith({
      id: 'figma-1',
      merchantKey: 'figma',
      name: 'Figma',
      currency: 'USD',
      recurrence: { kind: 'aroundDay', day: 3 },
      lastChargeTime: TWENTIETH_OF_OCTOBER,
      lastChargeAmountMinorUnits: 1500,
    });
    const hryvnias = seriesWith({});
    const { getByTestId } = await renderScreen({ series: [hryvnias, dollars], isLoading: false });

    const dollarRow = within(getByTestId(rowTestId(dollars)));
    const hryvniaRow = within(getByTestId(rowTestId(hryvnias)));

    expect(dollarRow.getByText('Figma')).toBeTruthy();
    expect(
      dollarRow.getByText(i18n.t('recurringCharges.monthlyAroundDay', { day: 3 })),
    ).toBeTruthy();
    expect(
      dollarRow.getByText(
        i18n.t('recurringCharges.lastCharge', { date: formatDate(TWENTIETH_OF_OCTOBER) }),
      ),
    ).toBeTruthy();
    expect(getByTestId(rowTestId(dollars))).toHaveTextContent(amountOf(dollars), { exact: false });
    expect(getByTestId(rowTestId(dollars))).not.toHaveTextContent(amountOf(hryvnias), {
      exact: false,
    });

    expect(hryvniaRow.getByText('Netflix')).toBeTruthy();
    expect(hryvniaRow.getByText(i18n.t('recurringCharges.monthlyOnDay', { day: 15 }))).toBeTruthy();
    expect(getByTestId(rowTestId(hryvnias))).toHaveTextContent(amountOf(hryvnias), {
      exact: false,
    });
    expect(getByTestId(rowTestId(hryvnias))).not.toHaveTextContent(amountOf(dollars), {
      exact: false,
    });
  });

  it('lists two series under one name as two rows', async () => {
    const cheaper = seriesWith({
      id: 'apple-1',
      merchantKey: 'apple',
      name: 'Apple',
      lastChargeAmountMinorUnits: 9900,
    });
    const dearer = seriesWith({
      id: 'apple-2',
      merchantKey: 'apple',
      name: 'Apple',
      lastChargeAmountMinorUnits: 49900,
    });
    const { getAllByText, getByTestId } = await renderScreen({
      series: [cheaper, dearer],
      isLoading: false,
    });

    expect(getAllByText('Apple')).toHaveLength(2);
    expect(getByTestId(rowTestId(cheaper))).toHaveTextContent(amountOf(cheaper), { exact: false });
    expect(getByTestId(rowTestId(dearer))).toHaveTextContent(amountOf(dearer), { exact: false });
  });

  it('shows a stopped series with its stopped line and its amount, so two stopped rows under one name differ', async () => {
    const cheaper = seriesWith({
      id: 'apple-1',
      merchantKey: 'apple',
      name: 'Apple',
      isStopped: true,
      lastChargeTime: FIRST_OF_MAY,
      lastChargeAmountMinorUnits: 29900,
    });
    const dearer = seriesWith({
      id: 'apple-2',
      merchantKey: 'apple',
      name: 'Apple',
      isStopped: true,
      lastChargeTime: FIRST_OF_MAY,
      lastChargeAmountMinorUnits: 59900,
    });
    const { getByTestId } = await renderScreen({ series: [cheaper, dearer], isLoading: false });

    const stoppedLine = i18n.t('recurringCharges.noChargeSince', {
      date: formatDate(FIRST_OF_MAY),
    });

    expect(within(getByTestId(rowTestId(cheaper))).getByText(stoppedLine)).toBeTruthy();
    expect(within(getByTestId(rowTestId(dearer))).getByText(stoppedLine)).toBeTruthy();
    expect(getByTestId(rowTestId(cheaper))).toHaveTextContent(amountOf(cheaper), { exact: false });
    expect(getByTestId(rowTestId(cheaper))).not.toHaveTextContent(amountOf(dearer), {
      exact: false,
    });
    expect(getByTestId(rowTestId(dearer))).toHaveTextContent(amountOf(dearer), { exact: false });
    expect(getByTestId(rowTestId(dearer))).not.toHaveTextContent(amountOf(cheaper), {
      exact: false,
    });
  });

  it('shows a quiet series with the holding and the date of its newest row, and its amount', async () => {
    const quiet = seriesWith({
      id: 'gym-1',
      merchantKey: 'gym',
      name: 'Gym',
      isStopped: true,
      lastChargeTime: FIRST_OF_MAY,
      lastChargeAmountMinorUnits: 45000,
      quiet: { since: TENTH_OF_JUNE, holdingName: 'Wallet' },
    });
    const { getByTestId } = await renderScreen({ series: [quiet], isLoading: false });

    const row = within(getByTestId(rowTestId(quiet)));

    expect(
      row.getByText(
        i18n.t('recurringCharges.holdingQuietSince', {
          holding: 'Wallet',
          date: formatDate(TENTH_OF_JUNE),
        }),
      ),
    ).toBeTruthy();
    expect(
      row.queryByText(i18n.t('recurringCharges.noChargeSince', { date: formatDate(FIRST_OF_MAY) })),
    ).toBeNull();
    expect(getByTestId(rowTestId(quiet))).toHaveTextContent(amountOf(quiet), { exact: false });
  });
});
