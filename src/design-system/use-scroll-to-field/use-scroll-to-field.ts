import {
  scrollToField,
  useHeaderInset,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { useRef, type RefObject } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';

type ScrollToFieldControls = {
  scrollableRef: ReturnType<typeof useAnimatedRef<ScrollViewInstance>>;
  onContentSizeChange: (contentWidth: number, contentHeight: number) => void;
  scrollTo: (fieldRef: RefObject<FieldInstance | null>, onSettled?: () => void) => void;
};

/**
 * Everything a form screen needs to bring a field into view when a blocked Save
 * names it. Hand `scrollableRef` and `onContentSizeChange` to `Screen`, then
 * call `scrollTo` with the first invalid field's wrapper ref and, for a
 * focusable input, a follow-up that focuses it.
 *
 * `scrollableRef` is a reanimated `useAnimatedRef` (not a plain `useRef`) so
 * `useScrollOffset` can read the ScrollView's live content offset. The content
 * height lives in a ref, not state: it is read only imperatively at Save-press
 * time and must never re-render the screen. The offset and the content height
 * are read inside `scrollTo`, so a call made from a stale closure still sees
 * their current values.
 */
export const useScrollToField = (): ScrollToFieldControls => {
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);

  const onContentSizeChange = (_contentWidth: number, contentHeight: number): void => {
    contentHeightRef.current = contentHeight;
  };

  const scrollTo = (fieldRef: RefObject<FieldInstance | null>, onSettled?: () => void): void => {
    scrollToField(
      scrollableRef,
      fieldRef,
      { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
      onSettled,
    );
  };

  return { scrollableRef, onContentSizeChange, scrollTo };
};
