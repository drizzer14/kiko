import { View } from 'react-native';
import { createElement, Fragment } from 'react';
import { render } from '@testing-library/react-native';

import { headerConfigsIn } from './header-configs';

// The native host react-native-screens draws a navigation bar with, by its host name.
const headerConfig = (props: { title: string; hidden?: boolean }) =>
  createElement('RNSScreenStackHeaderConfig', props);

describe('headerConfigsIn', () => {
  it('is empty for an empty tree', () => {
    expect(headerConfigsIn(null)).toEqual([]);
  });

  it('is empty for a tree without a native header config', async () => {
    const { toJSON } = await render(<View testID="plain" />);

    expect(headerConfigsIn(toJSON())).toEqual([]);
  });

  it('reads the props of every native header config in the tree, in paint order', async () => {
    const { toJSON } = await render(
      <View>
        {headerConfig({ title: 'first' })}
        <View>{headerConfig({ title: 'second', hidden: true })}</View>
      </View>,
    );

    expect(headerConfigsIn(toJSON())).toEqual([
      { title: 'first' },
      { title: 'second', hidden: true },
    ]);
  });

  it('reads a tree of several roots', async () => {
    const { toJSON } = await render(
      createElement(Fragment, null, headerConfig({ title: 'one' }), headerConfig({ title: 'two' })),
    );

    expect(headerConfigsIn<{ title: string }>(toJSON()).map(({ title }) => title)).toEqual([
      'one',
      'two',
    ]);
  });
});
