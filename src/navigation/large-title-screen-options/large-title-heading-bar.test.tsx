import type { FC, ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { largeTitleHeadingOptions, largeTitleRestoredOptions } from './large-title-screen-options';

// The real derivation native-stack runs on the merged options: it decides the bar props that
// react-native-screens turns into the UIKit bar (translucent, background, shadow). It is read
// from the package file because the package exports no deep path.
const {
  useHeaderConfigProps,
} = require('../../../node_modules/@react-navigation/native-stack/lib/module/views/useHeaderConfigProps');

const Container: FC<{ children: ReactNode }> = ({ children }) => (
  <NavigationContainer>{children}</NavigationContainer>
);

type BarProps = {
  translucent: boolean;
  backgroundColor: string;
  hideShadow: boolean;
  largeTitle: boolean | undefined;
};

const barProps = async (options: NativeStackNavigationOptions): Promise<BarProps> => {
  const { result } = await renderHook(
    () =>
      useHeaderConfigProps({
        ...options,
        route: { key: 'detail', name: 'Detail' },
        headerHeight: 100,
        headerTopInsetEnabled: true,
        headerBack: undefined,
      }),
    { wrapper: Container },
  );

  const { translucent, backgroundColor, hideShadow, largeTitle } = result.current;

  // Only the props that make up the bar's look: the rest holds React elements, which an
  // equality check cannot walk.
  return { translucent, backgroundColor, hideShadow, largeTitle };
};

const LARGE_TITLE: NativeStackNavigationOptions = { headerLargeTitle: true, title: 'A long title' };

describe('the bar of a screen showing its title as a heading', () => {
  it('stays translucent, so the content lays out under the bar as under a large title', async () => {
    const heading = await barProps({
      ...LARGE_TITLE,
      ...largeTitleHeadingOptions('A long title', false),
    });

    expect(heading.translucent).toBe(true);
    expect(heading.largeTitle).toBe(false);
  });

  // A large title bar is translucent through `headerLargeTitle`; without `headerTransparent` the
  // heading's inline bar would be opaque and lay the content out below it.
  it('would be opaque without the translucent option', async () => {
    const { headerTransparent: _headerTransparent, ...withoutTransparent } =
      largeTitleHeadingOptions('A long title', false);

    const heading = await barProps({ ...LARGE_TITLE, ...withoutTransparent });

    expect(heading.translucent).toBe(false);
  });

  it('has the transparent background and the shadow of the large title bar', async () => {
    const largeTitle = await barProps(LARGE_TITLE);
    const heading = await barProps({
      ...LARGE_TITLE,
      ...largeTitleHeadingOptions('A long title', true),
    });

    expect(heading.backgroundColor).toBe('transparent');
    expect(heading.backgroundColor).toBe(largeTitle.backgroundColor);
    // `undefined` in the large title bar, `false` here: both mean the shadow shows.
    expect(largeTitle.hideShadow).toBeFalsy();
    expect(heading.hideShadow).toBeFalsy();
  });

  it('is the large title bar again once restored', async () => {
    const largeTitle = await barProps(LARGE_TITLE);
    const restored = await barProps({
      ...LARGE_TITLE,
      ...largeTitleHeadingOptions('A long title', true),
      ...largeTitleRestoredOptions,
    });

    expect(restored).toEqual(largeTitle);
  });
});
