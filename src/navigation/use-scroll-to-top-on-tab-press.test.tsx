import { render } from '@testing-library/react-native';
import { createRef, type RefObject } from 'react';
import { Text } from 'react-native';

// `useScrollToTop` reads the React Navigation context and throws when there is
// none (a standalone render has none), so stand it in with a spy: the wrapper's
// only job is to forward the given ref to it, which is what this asserts.
const mockUseScrollToTop = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useScrollToTop: (...args: unknown[]) => mockUseScrollToTop(...args),
}));

import { type TabRootScrollable, useScrollToTopOnTabPress } from './use-scroll-to-top-on-tab-press';

const Probe = ({ scrollRef }: { scrollRef: RefObject<TabRootScrollable | null> }) => {
  useScrollToTopOnTabPress(scrollRef);

  return <Text>probe</Text>;
};

describe('useScrollToTopOnTabPress', () => {
  beforeEach(() => {
    mockUseScrollToTop.mockClear();
  });

  it('subscribes the given scrollable ref to the active-tab re-tap via useScrollToTop', async () => {
    const scrollRef = createRef<TabRootScrollable>();

    await render(<Probe scrollRef={scrollRef} />);

    // React Navigation's `useScrollToTop` owns the `tabPress` subscription, the
    // focused-tab / root-screen gating, and the scroll — the wrapper only hands
    // it the same ref object, unwrapped, so the wiring stays in one place.
    expect(mockUseScrollToTop).toHaveBeenCalledTimes(1);
    expect(mockUseScrollToTop).toHaveBeenCalledWith(scrollRef);
  });
});
