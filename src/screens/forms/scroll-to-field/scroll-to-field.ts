import type { ComponentRef, RefObject } from 'react';
import type { ScrollViewInstance, View } from 'react-native';

// How far above a scrolled-to field's own top edge to stop, so the field
// isn't flush against the screen edge (matches the visual breathing room
// CategoryField's own scrollToSelected leaves — see category-field.component.tsx).
const SCROLL_TOP_PADDING = 16;

type ScrollableRef = RefObject<ScrollViewInstance | null> | { current: ScrollViewInstance | null };

// The field's own host INSTANCE (what a `View` ref actually resolves to,
// carrying `measureLayout`) — not the `View` component type itself. Exported
// so every form field ref (holding-form, transaction-form, ...) can share
// this exact shape rather than each re-deriving it.
export type FieldInstance = ComponentRef<typeof View>;

type FieldRef = RefObject<FieldInstance | null> | { current: FieldInstance | null };

// Scrolls `scrollableRef`'s content so `fieldRef`'s own top edge lands near
// the top of the visible scroll area — every multi-field form's Save-press
// validation calls this with the FIRST invalid field's ref (see holding-form
// and transaction-form). `measureLayout` resolves the field's y-offset
// relative to the ScrollView's own native node (its own ancestor argument),
// so this is correct regardless of how many plain Box wrappers sit between
// the field and the ScrollView's content root — unlike summing each
// wrapper's own onLayout offset, which only works when every ancestor's own
// origin matches the scroll content's.
export const scrollToField = (scrollableRef: ScrollableRef, fieldRef: FieldRef): void => {
  const scrollView = scrollableRef.current;
  const field = fieldRef.current;

  if (scrollView === null || field === null) {
    return;
  }

  field.measureLayout(
    scrollView,
    (_x: number, y: number) => {
      scrollView.scrollTo({ y: Math.max(y - SCROLL_TOP_PADDING, 0), animated: true });
    },
    () => {
      // measureLayout can fail transiently (e.g. the field unmounted between
      // the Save press and this callback firing) — no-op rather than throw.
      // The user still sees the field's own inline error, just without the
      // scroll.
    },
  );
};
