import { Pressable, Text, View } from 'react-native';
import { type ReactElement, useContext } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { navigationSpy, type NavigationSpy } from '@kiko/test-support/navigation-props';

import '@kiko/design-system/unistyles';

import LargeTitleHeading, {
  LargeTitleHeadingContext,
} from '@kiko/design-system/components/large-title-heading';

import {
  largeTitleHeadingOptions,
  largeTitleRestoredOptions,
  largeTitleScreenOptions,
} from '../large-title-screen-options';

import { fittingLargeTitleLayout } from '.';
import { useTitleFit } from './use-title-fit';

const TITLE = 'A title that is much too long for one line';

// Jest lays no text out, so `jest/setup.js` mocks `useTitleFit` to "fits"; this sets the answer
// for the heading path.
const forceTitleFit = (fits: boolean, measurer: ReactElement | null = null): void => {
  jest.mocked(useTitleFit).mockReturnValue({ fits, measurer });
};

// What a screen has from the layout, with or without the heading it is meant to render.
const Controls = () => {
  const heading = useContext(LargeTitleHeadingContext);

  return (
    <>
      <Text testID="heading-title">{heading?.title ?? 'native large title'}</Text>

      <Text testID="heading-scrolled">{String(heading?.scrolled)}</Text>

      <Pressable testID="scroll-under" onPress={() => heading?.onScrolledChange(true)} />

      <Pressable testID="scroll-back" onPress={() => heading?.onScrolledChange(false)} />
    </>
  );
};

const Screen = () => (
  <>
    <Controls />

    <LargeTitleHeading />
  </>
);

const layoutOf = (
  navigation: NavigationSpy,
  options: NativeStackNavigationOptions,
  children = <Screen />,
) => fittingLargeTitleLayout({ navigation, options, children });

const LARGE_TITLE_OPTIONS: NativeStackNavigationOptions = {
  ...largeTitleScreenOptions,
  title: TITLE,
};

describe('fittingLargeTitleLayout', () => {
  afterEach(() => {
    forceTitleFit(true);
  });

  it('leaves a title that fits to the native large title', async () => {
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));

    expect(navigation.setOptions).not.toHaveBeenCalled();
    expect(getByTestId('heading-title').props.children).toBe('native large title');
  });

  it('switches to the inline bar and shows the whole title as a heading when it does not fit', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));

    expect(navigation.setOptions.mock.calls).toEqual([[largeTitleHeadingOptions(TITLE, false)]]);
    expect(getByTestId('heading-title').props.children).toBe(TITLE);
  });

  // A future plain or bleed-top screen with a long title never renders the heading; blanking its
  // title and switching off its large title would then leave it with no title at all.
  it('keeps the native bar while no screen renders the heading', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();

    await render(layoutOf(navigation, LARGE_TITLE_OPTIONS, <Controls />));

    expect(navigation.setOptions).not.toHaveBeenCalled();
  });

  it('does not switch again on the re-render that carries its own options', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { rerender } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));

    await rerender(
      layoutOf(navigation, { ...LARGE_TITLE_OPTIONS, ...largeTitleHeadingOptions(TITLE, false) }),
    );

    expect(navigation.setOptions).toHaveBeenCalledTimes(1);
  });

  it('brings the native large title back once the title fits again', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const switchedOptions = { ...LARGE_TITLE_OPTIONS, ...largeTitleHeadingOptions(TITLE, false) };
    const { rerender, getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));
    await rerender(layoutOf(navigation, switchedOptions));

    forceTitleFit(true);
    await rerender(layoutOf(navigation, { ...switchedOptions, title: 'Short' }));

    expect(navigation.setOptions).toHaveBeenCalledTimes(2);
    expect(navigation.setOptions).toHaveBeenLastCalledWith(largeTitleRestoredOptions);
    expect(getByTestId('heading-title').props.children).toBe('native large title');
  });

  it('shows the new title in the heading when the title changes', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { rerender, getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));

    await rerender(layoutOf(navigation, { ...LARGE_TITLE_OPTIONS, title: 'Another long title' }));

    expect(navigation.setOptions).toHaveBeenLastCalledWith(
      largeTitleHeadingOptions('Another long title', false),
    );
    expect(getByTestId('heading-title').props.children).toBe('Another long title');
  });

  it('shows the title in the bar once the heading has scrolled under it, and hides it again', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));

    await fireEvent.press(getByTestId('scroll-under'));
    await fireEvent.press(getByTestId('scroll-under'));
    await fireEvent.press(getByTestId('scroll-back'));

    expect(navigation.setOptions.mock.calls).toEqual([
      [largeTitleHeadingOptions(TITLE, false)],
      [largeTitleHeadingOptions(TITLE, true)],
      [largeTitleHeadingOptions(TITLE, false)],
    ]);
  });

  it('tells the heading whether it has scrolled under the bar', async () => {
    forceTitleFit(false);
    const { getByTestId } = await render(layoutOf(navigationSpy(), LARGE_TITLE_OPTIONS));

    expect(getByTestId('heading-scrolled').props.children).toBe('false');

    await fireEvent.press(getByTestId('scroll-under'));

    expect(getByTestId('heading-scrolled').props.children).toBe('true');
  });

  it('starts the next heading unscrolled after the native large title was back in between', async () => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { rerender, getByTestId } = await render(layoutOf(navigation, LARGE_TITLE_OPTIONS));
    await fireEvent.press(getByTestId('scroll-under'));
    const scrolledOptions = { ...LARGE_TITLE_OPTIONS, ...largeTitleHeadingOptions(TITLE, true) };

    forceTitleFit(true);
    await rerender(layoutOf(navigation, scrolledOptions));
    forceTitleFit(false);
    await rerender(layoutOf(navigation, { ...scrolledOptions, ...largeTitleRestoredOptions }));

    expect(navigation.setOptions).toHaveBeenLastCalledWith(largeTitleHeadingOptions(TITLE, false));
  });

  it.each([
    ['a hidden header', { ...LARGE_TITLE_OPTIONS, headerShown: false }],
    ['no large title', { title: TITLE }],
    ['a large title switched off', { title: TITLE, headerLargeTitle: false }],
    ['an empty title', { ...largeTitleScreenOptions, title: '' }],
    ['no title', { ...largeTitleScreenOptions }],
  ])('leaves a screen with %s alone, whatever the measurement says', async (_name, options) => {
    forceTitleFit(false);
    const navigation = navigationSpy();
    const { getByTestId } = await render(layoutOf(navigation, options));

    expect(navigation.setOptions).not.toHaveBeenCalled();
    expect(getByTestId('heading-title').props.children).toBe('native large title');
  });

  it('renders the measuring element only for a screen with a large title to measure', async () => {
    forceTitleFit(true, <View testID="measurer" />);
    const measured = await render(layoutOf(navigationSpy(), LARGE_TITLE_OPTIONS));
    const hiddenHeader = await render(
      layoutOf(navigationSpy(), { ...LARGE_TITLE_OPTIONS, headerShown: false }),
    );

    expect(measured.queryByTestId('measurer')).toBeTruthy();
    expect(hiddenHeader.queryByTestId('measurer')).toBeNull();
  });
});
