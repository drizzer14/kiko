import { useContext } from 'react';
import { Pressable, Text } from 'react-native';
import { HeaderBackContext } from '@react-navigation/elements';
import { fireEvent, render } from '@testing-library/react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { navigationSpy, type NavigationSpy } from '@kiko/test-support/navigation-props';

import '@kiko/design-system/unistyles';

import LargeTitleHeading, {
  LargeTitleHeadingContext,
} from '@kiko/design-system/components/large-title-heading';

import {
  inRowTitleOptions,
  largeTitleHeadingOptions,
  largeTitleRestoredOptions,
  largeTitleScreenOptions,
} from '../large-title-screen-options';

import { fittingLargeTitleLayout } from '.';
import { useTitleFit } from './use-title-fit';
import { useInRowTitle } from './use-in-row-title';

jest.mock('./use-in-row-title');

const TITLE = 'Statistics';
const LONG_TITLE = 'A title that is much too long for one line';

const place = (fits: boolean, beside: boolean): void => {
  jest.mocked(useTitleFit).mockReturnValue({ fits, measurer: null });
  jest.mocked(useInRowTitle).mockReturnValue(beside);
};

const Screen = () => {
  const heading = useContext(LargeTitleHeadingContext);

  return (
    <>
      <Text testID="heading-in-row">{String(heading?.inRow)}</Text>

      <Text testID="heading-title">{heading?.title ?? 'native large title'}</Text>

      <Pressable testID="scroll-under" onPress={() => heading?.onScrolledChange(true)} />

      <LargeTitleHeading />
    </>
  );
};

const optionsOf = (title: string): NativeStackNavigationOptions => ({
  ...largeTitleScreenOptions,
  title,
});

// A page after the first of its pane has a native Back button in the bar's leading slot, whether
// or not its options name an item: the native stack tells its screen through `HeaderBackContext`,
// which is empty on the first page of the pane.
const BACK = { title: 'Back', href: undefined };

const layoutOf = (
  navigation: NavigationSpy,
  title: string,
  extraOptions: NativeStackNavigationOptions = {},
  hasBack = false,
) => (
  <HeaderBackContext.Provider value={hasBack ? BACK : undefined}>
    {fittingLargeTitleLayout({
      navigation,
      options: { ...optionsOf(title), ...extraOptions },
      children: <Screen />,
    })}
  </HeaderBackContext.Provider>
);

// Each bar item option the in-row heading must yield to, one case per option. The key is computed
// so the one-item-per-form-header lint rule, which targets app code, does not read a test double.
const BAR_ITEM_OPTIONS = [
  'headerLeft',
  'headerRight',
  'unstable_headerLeftItems',
  'unstable_headerRightItems',
] as const;

const barItemOptions = (name: (typeof BAR_ITEM_OPTIONS)[number]): NativeStackNavigationOptions => ({
  [name]: () => (name.startsWith('unstable') ? [] : null),
});

describe('fittingLargeTitleLayout in the left pane beside a side bar', () => {
  afterEach(() => {
    place(true, false);
  });

  it('shows a title that fits in the bar row, when the bar is empty on the first page of the pane', async () => {
    place(true, true);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, TITLE));

    expect(navigation.setOptions.mock.calls).toEqual([[inRowTitleOptions()]]);
    expect(getByTestId('heading-in-row').props.children).toBe('true');
    expect(getByTestId('heading-title').props.children).toBe(TITLE);
  });

  it('keeps the bar empty after the heading has scrolled', async () => {
    place(true, true);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, TITLE));

    await fireEvent.press(getByTestId('scroll-under'));

    expect(navigation.setOptions.mock.calls.at(-1)).toEqual([inRowTitleOptions()]);
  });

  it.each(BAR_ITEM_OPTIONS)(
    'puts a title that fits below the bar when the screen sets %s',
    async (name) => {
      place(true, true);
      const navigation = navigationSpy();
      const { getByTestId } = await render(layoutOf(navigation, TITLE, barItemOptions(name)));

      expect(navigation.setOptions.mock.calls).toEqual([[largeTitleHeadingOptions(TITLE, false)]]);
      expect(getByTestId('heading-in-row').props.children).toBe('false');
      expect(getByTestId('heading-title').props.children).toBe(TITLE);
    },
  );

  it('puts a title that fits below the bar on a page after the first of its pane', async () => {
    place(true, true);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, TITLE, {}, true));

    expect(navigation.setOptions.mock.calls).toEqual([[largeTitleHeadingOptions(TITLE, false)]]);
    expect(getByTestId('heading-in-row').props.children).toBe('false');
  });

  it('keeps the wrapping heading below the bar for a title that does not fit', async () => {
    place(false, true);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, LONG_TITLE));

    expect(navigation.setOptions.mock.calls).toEqual([
      [largeTitleHeadingOptions(LONG_TITLE, false)],
    ]);
    expect(getByTestId('heading-in-row').props.children).toBe('false');
  });

  it('leaves a title that fits to the native large title anywhere else', async () => {
    place(true, false);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, TITLE));

    expect(navigation.setOptions).not.toHaveBeenCalled();
    expect(getByTestId('heading-title').props.children).toBe('native large title');
  });

  it('brings the native large title back when the pane leaves the row placement', async () => {
    place(true, true);
    const navigation = navigationSpy();
    const { rerender } = await render(layoutOf(navigation, TITLE));

    place(true, false);
    await rerender(layoutOf(navigation, TITLE));

    expect(navigation.setOptions.mock.calls.at(-1)).toEqual([
      largeTitleRestoredOptions(optionsOf(TITLE)),
    ]);
  });
});
