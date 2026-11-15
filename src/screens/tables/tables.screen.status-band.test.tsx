import { Animated } from 'react-native';
import '@kiko/design-system/unistyles';
import { render } from '@testing-library/react-native';
import { HeaderMinimizationContext } from 'react-native-screens';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import { renderTables, screenElement, setUpTablesWorld } from './__fixtures__/tables-screen-world';

jest.mock('@kiko/navigation/pane-stack', () =>
  (
    require('@kiko/test-support/mock-pane-stack') as typeof import('@kiko/test-support/mock-pane-stack')
  ).paneStackModule(() => jest.fn(), { useIsScreenVisible: () => true }),
);
jest.mock('@react-navigation/native-stack', () =>
  (
    require('@kiko/test-support/mock-header-height') as typeof import('@kiko/test-support/mock-header-height')
  ).nativeStackModule(),
);

describe('the status band of the Tables screen', () => {
  setUpTablesWorld();

  describe.each([
    ['categories', 'category-table'],
    ['cashFlow', 'cash-flow-table'],
    ['netWorth', 'net-worth-table'],
  ] as const)('on the %s view', (view, tableId) => {
    it("hands the screen's bar minimization to its table, which draws the band", async () => {
      const rendered = await render(
        <HeaderMinimizationContext.Provider value={new Animated.Value(0)}>
          {screenElement({ view })}
        </HeaderMinimizationContext.Provider>,
        { wrapper: GestureRootWrapper },
      );

      expect(
        rendered.getByTestId(`${tableId}-status-band`, { includeHiddenElements: true }),
      ).toBeTruthy();
    });

    it('draws no band where the screen has no bar minimization', async () => {
      const rendered = await renderTables({ view });

      expect(
        rendered.queryByTestId(`${tableId}-status-band`, { includeHiddenElements: true }),
      ).toBeNull();
    });
  });
});
