import { View } from 'react-native';
import { render, within } from '@testing-library/react-native';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';

import '@kiko/design-system/unistyles';

import StatisticsGrid from '.';

const FULL_WIDTH = ['line', 'bar', 'trend'].map((name) => <View key={name} testID={name} />);
const SHARED = [
  <View key="category" testID="category" />,
  <View key="pie" testID="pie" />,
] as const;

const CARD_IDS = ['line', 'bar', 'trend', 'category', 'pie'];

const renderGrid = (isRowShared: boolean) =>
  render(
    <View testID="root">
      <StatisticsGrid isRowShared={isRowShared} fullWidth={FULL_WIDTH} shared={SHARED} />
    </View>,
  );

const cardsOf = (view: Awaited<ReturnType<typeof renderGrid>>) =>
  testIdsInOrder(view.toJSON()).filter((id) => CARD_IDS.includes(id));

describe('StatisticsGrid', () => {
  it('renders the five cards in order with no row when the row is not shared', async () => {
    const view = await renderGrid(false);

    expect(cardsOf(view)).toEqual(CARD_IDS);
    expect(view.queryAllByTestId('statistics-grid-row')).toHaveLength(0);
  });

  it('renders the full-width cards, then one row holding the two shared cards, when shared', async () => {
    const view = await renderGrid(true);
    const rows = view.getAllByTestId('statistics-grid-row');

    expect(cardsOf(view)).toEqual(CARD_IDS);
    expect(rows).toHaveLength(1);
    expect(CARD_IDS.filter((id) => within(rows[0]).queryByTestId(id))).toEqual(['category', 'pie']);
  });

  it.each([true, false])(
    'renders with the row shared: %s, without a duplicate or missing key warning',
    async (isRowShared) => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await renderGrid(isRowShared);

        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    },
  );
});
