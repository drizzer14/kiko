import { createRef } from 'react';
import { render } from '@testing-library/react-native';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it.
import { mockFindNodeHandle } from '@kiko/test-support/node-handles';
import { findNodeHandle, View, type ViewInstance } from 'react-native';

import { shareAnchorOf } from './share-anchor';

jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
  ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
  findNodeHandle: (node: unknown) => mockFindNodeHandle(node),
}));

describe('shareAnchorOf', () => {
  it('returns the node handle of a mounted host', async () => {
    const control = createRef<ViewInstance>();
    await render(<View ref={control} />);

    const anchor = shareAnchorOf(control.current);

    expect(typeof anchor).toBe('number');
    expect(anchor).toBe(findNodeHandle(control.current));
  });

  it('gives two different hosts two different anchors', async () => {
    const first = createRef<ViewInstance>();
    const second = createRef<ViewInstance>();
    await render(
      <>
        <View ref={first} />
        <View ref={second} />
      </>,
    );

    expect(shareAnchorOf(first.current)).not.toBe(shareAnchorOf(second.current));
  });

  it('returns undefined when the control is gone', () => {
    expect(shareAnchorOf(null)).toBeUndefined();
  });
});
