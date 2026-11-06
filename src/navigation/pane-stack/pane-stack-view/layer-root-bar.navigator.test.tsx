import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { act, render, screen } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';

import '@kiko/design-system/unistyles';

import HomeStack from '@kiko/navigation/home-stack';
import StatisticsStack from '@kiko/navigation/statistics-stack';

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@kiko/navigation/merged-home', () => ({
  useLeaveStatisticsTabWhenMerged: () => undefined,
  useIsMergedHome: () => false,
}));
jest.mock('@kiko/screens/home', () => {
  const HomeScreenStub = () => null;

  return { __esModule: true, default: HomeScreenStub };
});
jest.mock('@kiko/screens/tables', () => {
  const TablesScreenStub = () => null;

  return { __esModule: true, default: TablesScreenStub };
});
jest.mock('@kiko/screens/statistics', () => {
  const StatisticsScreenStub = () => null;

  return { __esModule: true, default: StatisticsScreenStub };
});
jest.mock('@kiko/screens/forms/account-form', () => {
  const AccountFormScreenStub = () => null;

  return { __esModule: true, default: AccountFormScreenStub };
});
jest.mock('@kiko/screens/forms/holding-form', () => {
  const HoldingFormScreenStub = () => null;

  return { __esModule: true, default: HoldingFormScreenStub };
});
jest.mock('@kiko/screens/forms/transaction-form', () => {
  const TransactionFormScreenStub = () => null;

  return { __esModule: true, default: TransactionFormScreenStub };
});

type HeaderConfig = {
  title: string;
  hidden?: boolean;
  backgroundColor: string;
  hideShadow?: boolean;
  largeTitle?: boolean;
  translucent: boolean;
  blurEffect?: string;
  largeTitleBackgroundColor?: string;
  largeTitleHideShadow?: boolean;
};

type RenderedNode = { type: string; props: object; children: (RenderedNode | string)[] | null };

const headerConfigsOf = (node: RenderedNode | string | null): HeaderConfig[] =>
  node === null || typeof node === 'string'
    ? []
    : [
        ...(node.type === 'RNSScreenStackHeaderConfig' ? [node.props as HeaderConfig] : []),
        ...(node.children ?? []).flatMap(headerConfigsOf),
      ];

const headerConfigs = (): HeaderConfig[] => {
  const tree = screen.toJSON() as RenderedNode | RenderedNode[] | null;

  return [tree].flat().flatMap(headerConfigsOf);
};

// The layer's root is the one page whose title is empty: every other page, the panes' too, is
// named by its title or, with none, by its route name.
const layerRootBar = (): HeaderConfig => {
  const roots = headerConfigs().filter(({ title }) => title === '');

  expect(roots).toHaveLength(1);

  return roots[0];
};

const tablesBar = (): HeaderConfig => {
  const tables = headerConfigs().filter(({ title }) => title === 'tables.title');

  expect(tables).toHaveLength(1);

  return tables[0];
};

// What the shared navigation bar is drawn from: every header config prop that
// `RNSScreenStackHeaderConfig.buildAppearance` and the scroll-edge appearance read for the
// background (the title and font props are left out: the root shows no title). `largeTitle` is read
// as on or off: a stack that sets no large title leaves it undefined, which the native side reads
// as off.
const lookOf = ({
  backgroundColor,
  blurEffect,
  hideShadow,
  largeTitle,
  largeTitleBackgroundColor,
  largeTitleHideShadow,
  translucent,
}: HeaderConfig) => ({
  backgroundColor,
  blurEffect,
  hideShadow,
  largeTitle: largeTitle === true,
  largeTitleBackgroundColor,
  largeTitleHideShadow,
  translucent,
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

// Root and Tables share one navigation bar, and a swipe back moves UIKit from the one's appearance
// to the other's: a root that looks unlike Tables fades the bar's background during the swipe.
// This renders each real stack through the real native-stack and reads the props the native bar
// is given. Jest proves props only, not the UIKit transition or the bar's hide at the end of a
// pop: those are checked on a device.
describe.each([
  ['Home', HomeStack],
  ['Statistics', StatisticsStack],
] as const)('the layer root of the %s stack', (_name, Stack) => {
  const renderStack = async (): Promise<void> => {
    await emitLayoutMode('columns');
    await render(
      <NavigationContainer ref={navigationRef}>
        <Stack />
      </NavigationContainer>,
    );
  };

  afterEach(() => {
    resetLayoutMode();
  });

  it('has a bar that looks as Tables does while Tables is in the layer', async () => {
    await renderStack();
    await act(async () => navigationRef.navigate('Tables'));

    expect(layerRootBar().hidden).not.toBe(true);
    expect(lookOf(layerRootBar())).toEqual(lookOf(tablesBar()));
  });

  it('has no bar at rest, so the panes behind it take taps at the top', async () => {
    await renderStack();

    expect(layerRootBar().hidden).toBe(true);
  });
});
