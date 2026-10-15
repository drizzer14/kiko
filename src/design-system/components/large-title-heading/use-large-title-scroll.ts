import { useContext, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { HeaderHeightContext } from '@react-navigation/elements';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { LargeTitleHeadingContext } from './large-title-heading.context';

// One scroll event per frame, so the bar title appears the moment the heading goes under it.
const SCROLL_EVENT_THROTTLE_MS = 16;

type ScrollProps = {
  onScroll: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
  scrollEventThrottle: number | undefined;
};

const NO_HEADING_SCROLL: ScrollProps = { onScroll: undefined, scrollEventThrottle: undefined };

/**
 * Whether the heading's bottom edge has scrolled up under the navigation bar. The heading bar is
 * translucent (`largeTitleHeadingOptions`), so the content lays out under it and the scrollable's
 * automatic inset rests it one header height above offset zero, exactly as under a large title:
 * the scrolled distance is the offset plus the header height. A heading that has not been
 * measured yet is never scrolled past.
 */
export const scrolledPastHeading = (
  offsetY: number,
  headerHeight: number,
  headingBottom: number,
): boolean => headingBottom > 0 && offsetY + headerHeight >= headingBottom;

/**
 * The `onScroll` props for the scrollable that holds the heading: spread them onto the
 * `ScrollView` or `FlatList`. They report to the navigator layout when the heading goes under
 * the bar, so the bar can show the title then. With no heading showing they add nothing.
 */
export const useLargeTitleScroll = (): ScrollProps => {
  const heading = useContext(LargeTitleHeadingContext);
  const headerHeight = useContext(HeaderHeightContext) ?? 0;

  return useMemo(
    () =>
      foldMap(maybe(heading), (value) => ({
        onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) =>
          value.onScrolledChange(
            scrolledPastHeading(
              event.nativeEvent.contentOffset.y,
              headerHeight,
              value.headingBottom.current,
            ),
          ),
        scrollEventThrottle: SCROLL_EVENT_THROTTLE_MS,
      })) ?? NO_HEADING_SCROLL,
    [heading, headerHeight],
  );
};
