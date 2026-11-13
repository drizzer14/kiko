import { type RefObject, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, ScrollViewInstance } from 'react-native';

/**
 * What a picker sheet needs to open already scrolled to its selected row: a ref for the sheet's
 * ScrollView, its `onContentSizeChange`, and a per-row `onRowLayout(key, event)`. The scroll is
 * one-shot per open, so a manual scroll is never pulled back, and it re-arms when the sheet closes.
 */
type ScrollToSelected = {
  scrollRef: RefObject<ScrollViewInstance | null>;
  onContentSizeChange: () => void;
  onRowLayout: (key: string, event: LayoutChangeEvent) => void;
};

export const useScrollToSelected = (
  open: boolean,
  selectedKey: string | null,
): ScrollToSelected => {
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Each option row's vertical offset inside the ScrollView content, keyed by
  // option key and filled from each row's onLayout. Rows can differ in height
  // (a wrapped title runs taller), so a measured offset map lands the selected
  // row accurately where a uniform row-height estimate would drift.
  const rowOffsets = useRef<Record<string, number>>({});
  // One-shot guard: the auto-scroll fires exactly once per open. It is set the
  // moment we jump to the selection and re-armed when the sheet closes, so a
  // manual scroll is never yanked back by a late measurement pass, and a
  // reopen still lands on the selection.
  const hasScrolledToSelected = useRef(false);

  // Re-arm the one-shot as the sheet closes so the next open scrolls afresh.
  // The Modal keeps this subtree mounted, so the ref must be reset explicitly.
  useEffect(() => {
    if (!open) {
      hasScrolledToSelected.current = false;
    }
  }, [open]);

  // Jump the list so the selected row is already on screen instead of starting
  // at the top. Driven off the ScrollView's real measurement signals
  // (onContentSizeChange, and the selected row's own onLayout) rather than a
  // fixed single-frame defer: the heavier BottomSheet finalizes layout an
  // unknown number of frames late, so the scroll must wait for the content to
  // actually be measured. Guarded: not open, no selection, an unknown/top (0)
  // offset, or an already-consumed one-shot all leave the list where it is.
  const scrollToSelected = (): void => {
    if (!open || selectedKey === null || hasScrolledToSelected.current) {
      return;
    }

    const offset = rowOffsets.current[selectedKey];

    if (offset === undefined || offset === 0) {
      return;
    }

    hasScrolledToSelected.current = true;
    scrollRef.current?.scrollTo({ y: offset, animated: false });
  };

  const onRowLayout = (key: string, event: LayoutChangeEvent): void => {
    rowOffsets.current[key] = event.nativeEvent.layout.y;

    // Secondary trigger: if the SELECTED row's offset lands after the
    // content-size pass, jump the moment it is recorded. The one-shot guard
    // keeps the two triggers to a single scroll.
    if (key === selectedKey) {
      scrollToSelected();
    }
  };

  // Primary trigger: `onContentSizeChange` fires once the content size is finalized, however many
  // frames the heavier sheet took to settle; a row laid out earlier is already in the offset map.
  return { scrollRef, onContentSizeChange: scrollToSelected, onRowLayout };
};
