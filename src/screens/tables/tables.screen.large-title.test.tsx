import '@kiko/design-system/unistyles';
import type { render } from '@testing-library/react-native';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';
import { mockUseLiveQuery } from '@kiko/test-support/mock-statistics-data-layer';

import { renderTables, setUpTablesWorld } from './__fixtures__/tables-screen-world';

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

// Derived from `toJSON`'s own signature: the renderer's JSON type is not a declared dependency.
type RenderedTree = ReturnType<Awaited<ReturnType<typeof render>>['toJSON']>;
type RenderedNode = Exclude<RenderedTree, null | unknown[]>;

// The scroll view UIKit finds for a large title to collapse with: the first one down the
// first-child chain from the screen's root (react-native-screens' `RNSScrollViewFinder` walks
// `subviews[0]`). Jest draws every view, where Fabric drops layout-only ones, so this proves the
// order of the tree; that the native chain holds is checked on a device.
const firstScrollOfChain = (node: RenderedNode | string | undefined): RenderedNode | undefined => {
  if (node === undefined || typeof node === 'string') {
    return undefined;
  }

  return node.type === 'RCTScrollView' ? node : firstScrollOfChain(node.children?.[0]);
};

const trackedScrollOf = (tree: RenderedTree): RenderedNode | undefined =>
  firstScrollOfChain(Array.isArray(tree) ? undefined : (tree ?? undefined));

describe('the large title of the Tables screen', () => {
  setUpTablesWorld();

  describe.each([
    ['categories', 'category-table'],
    ['cashFlow', 'cash-flow-table'],
    ['netWorth', 'net-worth-table'],
  ] as const)('on the %s view', (view, tableId) => {
    it("collapses with the table's own scroll, which carries the automatic inset", async () => {
      const { toJSON } = await renderTables({ view });
      const tracked = trackedScrollOf(toJSON());

      expect(tracked?.props.testID).toBe(tableId);
      expect(tracked?.props.contentInsetAdjustmentBehavior).toBe('automatic');
    });

    it('scrolls the view switch away with the table, above the filters', async () => {
      const { toJSON } = await renderTables({ view });
      const ids = testIdsInOrder(toJSON());

      expect(ids.indexOf('tables-view')).toBeGreaterThan(ids.indexOf(`${tableId}-top`));
      expect(ids.indexOf('tables-view')).toBeLessThan(ids.indexOf('tables-filter-bar'));
    });
  });

  it('collapses with the loading screen too, so a title opened while the data loads does', async () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: true, isFresh: false }));

    const { toJSON, getByTestId } = await renderTables();
    const tracked = trackedScrollOf(toJSON());

    expect(tracked?.props.testID).toBe('screen-scroll-view');
    expect(tracked?.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(getByTestId('tables-loading')).toBeTruthy();
  });
});
