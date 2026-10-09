// Semgrep fixture (POSITIVE): kiko-architecture's "Pane navigation". A screen that can render as
// a pane default has no focus there, so `kiko-no-focus-hook-in-pane-default-screen` MUST report
// a finding on every pinned line below.
import { useCallback } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

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
