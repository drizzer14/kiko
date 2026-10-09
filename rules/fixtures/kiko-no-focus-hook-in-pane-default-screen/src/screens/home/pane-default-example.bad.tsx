// Semgrep fixture (POSITIVE): kiko-architecture's "Pane navigation". A screen that can render as
// a pane default has no focus there, so `kiko-no-focus-hook-in-pane-default-screen` MUST report
// a finding on every pinned line below.
import { useCallback } from 'react';
import * as Navigation from '@react-navigation/native';

// The plain import names both hooks.
// EXPECT-FINDING
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

// An alias hides the hook's name at every call site; the import still names it.
// EXPECT-FINDING
import { useIsFocused as focusedNow } from '@react-navigation/native';

// A clause spread over several lines.
// EXPECT-FINDING
import {
  useFocusEffect as onFocus,
} from '@react-navigation/native';

// A local re-export file, which a screen then imports under another name.
// EXPECT-FINDING
export { useIsFocused as useScreenFocus } from '@react-navigation/native';

// EXPECT-FINDING
export { useFocusEffect } from '@react-navigation/native';

export const PausesOnFocus = () => {
  // EXPECT-FINDING
  const isFocused = useIsFocused();

  return isFocused ? null : undefined;
};

export const AnswersOnFocus = () => {
  // EXPECT-FINDING
  useFocusEffect(useCallback(() => undefined, []));

  return null;
};

export const PausesOnFocusThroughANamespace = () => {
  // EXPECT-FINDING
  const isFocused = Navigation.useIsFocused();

  return isFocused ? null : undefined;
};

export const AnswersOnFocusThroughANamespace = () => {
  // EXPECT-FINDING
  Navigation.useFocusEffect(useCallback(() => undefined, []));

  return null;
};

export const aliases = [focusedNow, onFocus];
