import type { FC } from 'react';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

import { largeTitleHeadingOptions, largeTitleRestoredOptions } from './large-title-screen-options';

const Stack = createNativeStackNavigator();

const DetailScreen: FC = () => null;

type BarProps = {
  translucent: boolean;
  backgroundColor: string;
  hideShadow: boolean;
  largeTitle: boolean | undefined;
};

type RenderedNode = { type: string; props: object; children: (RenderedNode | string)[] | null };

const headerConfigsOf = (node: RenderedNode | string | null): BarProps[] => {
  if (node === null || typeof node === 'string') {
    return [];
  }

  return [
    ...(node.type === 'RNSScreenStackHeaderConfig' ? [node.props as BarProps] : []),
    ...(node.children ?? []).flatMap(headerConfigsOf),
  ];
};

// The bar props native-stack derives from the merged options and hands to react-native-screens,
// which turns them into the UIKit bar (translucent, background, shadow). They are read from the
// header config of a rendered stack.
const barProps = async (options: NativeStackNavigationOptions): Promise<BarProps> => {
  const view = await render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Detail" component={DetailScreen} options={options} />
      </Stack.Navigator>
    </NavigationContainer>,
  );

  const tree = view.toJSON() as RenderedNode | RenderedNode[] | null;
  const roots = Array.isArray(tree) ? tree : [tree];
  const [{ translucent, backgroundColor, hideShadow, largeTitle }] = roots.flatMap(headerConfigsOf);

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
