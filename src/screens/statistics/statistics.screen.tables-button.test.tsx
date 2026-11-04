import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { fireEvent, render, within } from '@testing-library/react-native';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';
import { answerFilterData, ACCOUNT_FILTER } from '@kiko/test-support/statistics-filter-data';
import { resetStatisticsFilterSelection } from '@kiko/test-support/reset-statistics-filter-selection';

import StatisticsScreen from './statistics.screen';

/**
 * The in-page row under the filter bar that opens the Tables screen. It sits in the one untagged
 * `Box` with the filter bar, so the children of `statistics-blocks` stay as they were.
 */

jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const TABLES_BUTTON = 'statistics-open-tables';

describe('the Tables button in Statistics', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockImplementation(answerFilterData);
  });

  afterEach(resetStatisticsFilterSelection);

  it('shows with accounts, labelled by its catalogue text', async () => {
    const { getByTestId } = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

    expect(getByTestId(TABLES_BUTTON)).toHaveTextContent('Monthly tables', { exact: false });
  });

  it('opens the Tables route with a navigate to its name', async () => {
    const { getByTestId } = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

    await fireEvent.press(getByTestId(TABLES_BUTTON));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Tables');
  });

  it('sits in the same box as the filter bar', async () => {
    const { getByTestId } = await render(<StatisticsScreen />, { wrapper: GestureRootWrapper });
    const firstBlock = getByTestId('statistics-blocks').children[0];

    expect(typeof firstBlock).toBe('object');

    const inside = within(firstBlock as Parameters<typeof within>[0]);

    expect(inside.getByTestId(ACCOUNT_FILTER)).toBeTruthy();
    expect(inside.getByTestId(TABLES_BUTTON)).toBeTruthy();
  });

  it('does not show in the empty state of a user with no account', async () => {
    mockUseLiveQuery.mockImplementation((query: { kind?: string }, tables: string[]) =>
      tables[0] === 'accounts' || tables[0] === 'holdings'
        ? { data: [], isLoading: false, isFresh: true }
        : answerFilterData(query, tables),
    );

    const { queryByTestId, getByTestId } = await render(<StatisticsScreen />, {
      wrapper: GestureRootWrapper,
    });

    expect(getByTestId('statistics-empty')).toBeTruthy();
    expect(queryByTestId(TABLES_BUTTON)).toBeNull();
  });

  it('does not show while the data loads', async () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: true, isFresh: false }));

    const { queryByTestId, getByTestId } = await render(<StatisticsScreen />, {
      wrapper: GestureRootWrapper,
    });

    expect(getByTestId('statistics-loading')).toBeTruthy();
    expect(queryByTestId(TABLES_BUTTON)).toBeNull();
  });
});
