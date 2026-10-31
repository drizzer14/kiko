import type { FC, ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';
import { HeaderHeightContext } from '@react-navigation/elements';

import { LargeTitleHeadingContext } from './large-title-heading.context';
import { scrolledPastHeading, useLargeTitleScroll } from './use-large-title-scroll';

const HEADER_HEIGHT = 100;
const HEADING_BOTTOM = 150;

const scrollEvent = (offsetY: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y: offsetY } } }) as never;

const withHeading =
  (
    onScrolledChange: jest.Mock,
    headingBottom: number,
    inRow = false,
  ): FC<{ children: ReactNode }> =>
  ({ children }) => (
    <HeaderHeightContext.Provider value={HEADER_HEIGHT}>
      <LargeTitleHeadingContext.Provider
        value={{
          title: 'A long title',
          inRow,
          scrolled: false,
          headingBottom: { current: headingBottom },
          onScrolledChange,
          onHostedChange: jest.fn(),
        }}
      >
        {children}
      </LargeTitleHeadingContext.Provider>
    </HeaderHeightContext.Provider>
  );

describe('scrolledPastHeading', () => {
  it('is false at rest, where the content starts one header height above offset zero', () => {
    expect(scrolledPastHeading(-HEADER_HEIGHT, HEADER_HEIGHT, HEADING_BOTTOM)).toBe(false);
  });

  it('is false while the heading still shows below the bar', () => {
    expect(
      scrolledPastHeading(HEADING_BOTTOM - HEADER_HEIGHT - 1, HEADER_HEIGHT, HEADING_BOTTOM),
    ).toBe(false);
  });

  it('is true once the heading is exactly under the bar, and beyond', () => {
    expect(scrolledPastHeading(HEADING_BOTTOM - HEADER_HEIGHT, HEADER_HEIGHT, HEADING_BOTTOM)).toBe(
      true,
    );
    expect(scrolledPastHeading(500, HEADER_HEIGHT, HEADING_BOTTOM)).toBe(true);
  });

  it('is false until the heading has been measured', () => {
    expect(scrolledPastHeading(500, HEADER_HEIGHT, 0)).toBe(false);
  });
});

describe('useLargeTitleScroll', () => {
  it('adds no scroll handling when the native large title shows the title', async () => {
    const { result } = await renderHook(() => useLargeTitleScroll());

    expect(result.current).toEqual({ onScroll: undefined, scrollEventThrottle: undefined });
  });

  it('asks for a scroll event every frame while a heading shows', async () => {
    const { result } = await renderHook(() => useLargeTitleScroll(), {
      wrapper: withHeading(jest.fn(), HEADING_BOTTOM),
    });

    expect(result.current.scrollEventThrottle).toBe(16);
  });

  // The bar is translucent, so the content rests at minus the header height. A heading shorter
  // than the bar must not read as scrolled from the first event, which an opaque bar (rest at
  // zero) would make it.
  it('reports a heading shorter than the bar as not scrolled at rest', async () => {
    const onScrolledChange = jest.fn();
    const { result } = await renderHook(() => useLargeTitleScroll(), {
      wrapper: withHeading(onScrolledChange, HEADER_HEIGHT - 2),
    });

    result.current.onScroll?.(scrollEvent(-HEADER_HEIGHT));

    expect(onScrolledChange.mock.calls).toEqual([[false]]);
  });

  it('reports the heading scrolled under the bar, and back', async () => {
    const onScrolledChange = jest.fn();
    const { result } = await renderHook(() => useLargeTitleScroll(), {
      wrapper: withHeading(onScrolledChange, HEADING_BOTTOM),
    });

    result.current.onScroll?.(scrollEvent(HEADING_BOTTOM - HEADER_HEIGHT));
    result.current.onScroll?.(scrollEvent(-HEADER_HEIGHT));

    expect(onScrolledChange.mock.calls).toEqual([[true], [false]]);
  });

  // The in-row heading scrolls out under an empty bar, so there is nothing to tell the layout.
  it('adds no scroll handling for the in-row heading', async () => {
    const { result } = await renderHook(() => useLargeTitleScroll(), {
      wrapper: withHeading(jest.fn(), HEADING_BOTTOM, true),
    });

    expect(result.current).toEqual({ onScroll: undefined, scrollEventThrottle: undefined });
  });
});
