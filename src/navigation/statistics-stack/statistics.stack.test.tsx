import { isValidElement, type ReactElement } from 'react';

// The real Statistics screen wired into this stack pulls in db/client, which
// opens a real op-sqlite connection at module load. op-sqlite has no Jest
// binary, so stub it the same way the root-navigator and repo tests do.
import '@kiko/design-system/unistyles';

// StatisticsStack() is called directly below (a plain function call, not a
// real React render — see screenNames), so its own useTranslation() call
// would throw ("Invalid hook call") outside a real component render. This
// test only reads route `name`s, not the translated title, so a no-op stub
// (returning the raw key) is enough to unblock the call.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The hook reads the tab navigator, so a plain call of the stack cannot run it.
const mockLeaveStatisticsTabWhenMerged = jest.fn();
jest.mock('@kiko/navigation/merged-home', () => ({
  useLeaveStatisticsTabWhenMerged: () => mockLeaveStatisticsTabWhenMerged(),
}));

import { fittingLargeTitleLayout } from '../fitting-large-title';
import { restoreDefaultAnimationOfSwappedForm } from '../swapped-form-options';

import StatisticsStack from './statistics.stack';

type ScreenElement = ReactElement<{ name: string }>;

// Walk the Stack.Screen children the StatisticsStack renders and read each
// screen's route name, so a test can assert the stack is rooted at Statistics.
const screenNames = (): string[] => {
  const navigator = StatisticsStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const screens = [navigator.props.children].flat().filter(isValidElement) as ScreenElement[];

  return screens.map((screen) => screen.props.name);
};

type FormOptions = { title?: string; animation?: string };

type FormScreenElement = ReactElement<{
  name: string;
  listeners?: unknown;
  options?: FormOptions | ((args: { route: { params: unknown } }) => FormOptions);
}>;

const screenOf = (name: string): FormScreenElement | undefined => {
  const navigator = StatisticsStack({}) as ReactElement<{ children: FormScreenElement[] }>;

  return navigator.props.children
    .filter(isValidElement)
    .find((screen) => screen.props.name === name);
};

const optionsOf = (name: string, params: unknown): FormOptions | undefined => {
  const options = screenOf(name)?.props.options;

  return typeof options === 'function' ? options({ route: { params } }) : options;
};

describe('StatisticsStack', () => {
  beforeEach(() => {
    mockLeaveStatisticsTabWhenMerged.mockClear();
  });

  it('leaves the Statistics tab for Home when the window merges them', () => {
    StatisticsStack({});

    expect(mockLeaveStatisticsTabWhenMerged).toHaveBeenCalledTimes(1);
  });

  it('is rooted at the Statistics screen', () => {
    expect(screenNames()).toContain('Statistics');
  });

  it('registers the create forms the Transaction form opens from an empty holding picker', () => {
    expect(screenNames()).toEqual(expect.arrayContaining(['AccountForm', 'HoldingForm']));
  });

  it('titles the Statistics screen with the translated statistics.title', () => {
    const navigator = StatisticsStack({}) as ReactElement<{
      children: ReactElement<{ name: string; options: { title: string } }>[];
    }>;
    const statistics = [navigator.props.children]
      .flat()
      .find((screen) => screen.props.name === 'Statistics');

    expect(statistics?.props.options).toEqual({ title: 'statistics.title' });
  });

  it('titles the Transaction form with the translated add title', () => {
    expect(screenOf('TransactionForm')?.props.options).toEqual({
      title: 'forms.transaction.addTitle',
    });
  });

  it('hides the header of the Home companion', () => {
    expect(screenOf('Home')?.props.options).toEqual({ headerShown: false });
  });

  it.each([
    ['AccountForm', 'forms.account.addTitle'],
    ['HoldingForm', 'forms.holding.addTitle'],
  ])('gives %s its add title and the default animation when no draft is carried', (name, title) => {
    expect(optionsOf(name, { accountId: 'account-1' })).toEqual({ title, animation: 'default' });
  });

  it('titles the implicit holding form like an account and swaps it without an animation', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    expect(optionsOf('HoldingForm', { implicitKind: 'property', draft })).toEqual({
      title: 'forms.account.addTitle',
      animation: 'none',
    });
  });

  it('swaps the account form in without an animation when it carries a draft', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    expect(optionsOf('AccountForm', { draft })?.animation).toBe('none');
  });

  it('keeps the default animation on a form that holds its own saved draft', () => {
    const savedDraft = { saved: true, name: 'Flat', icon: null, color: null };

    expect(optionsOf('AccountForm', { draft: savedDraft })?.animation).toBe('default');
    expect(optionsOf('HoldingForm', { accountId: 'account-1', draft: savedDraft })?.animation).toBe(
      'default',
    );
  });

  it.each(['AccountForm', 'HoldingForm'])(
    'restores the default animation of a swapped %s once it has appeared',
    (name) => {
      expect(screenOf(name)?.props.listeners).toBe(restoreDefaultAnimationOfSwappedForm);
    },
  );

  it('roots Statistics in the primary pane and defaults the companion to Home', () => {
    const navigator = StatisticsStack({}) as ReactElement<{ paneConfig: object }>;

    expect(navigator.props.paneConfig).toEqual({
      rootPane: 'primary',
      companionDefault: { name: 'Home', isDefault: true },
    });
  });

  it('wraps every screen in the fitting large-title layout', () => {
    const navigator = StatisticsStack({}) as ReactElement<{ screenLayout: unknown }>;

    expect(navigator.props.screenLayout).toBe(fittingLargeTitleLayout);
  });

  // Jest pins `isLiquidGlassSupported` to false (jest/setup.js), the iOS < 26
  // tier, where the scrolled bar needs the blur react-native-screens omits.
  it('uses the shared large-title options, with the scrolled-bar blur below iOS 26', () => {
    const navigator = StatisticsStack({}) as ReactElement<{ screenOptions: object }>;

    expect(navigator.props.screenOptions).toEqual({
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterialDark',
      headerLargeStyle: { backgroundColor: 'transparent' },
    });
  });
});
