// Semgrep fixture (NEGATIVE): kiko-architecture's "Pane navigation". Nothing here reads focus, so
// `kiko-no-focus-hook-in-pane-default-screen` (and every other rule) MUST report zero findings.
import { useEffect } from 'react';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';

export const PausesOnVisibility = () => {
  const isVisible = useIsScreenVisible();

  useEffect(() => {
    if (isVisible) {
      return;
    }
  }, [isVisible]);

  // Prose and a mock key name the hook without calling it.
  const description = 'useIsFocused and useFocusEffect never run in a default';
  const mock = { useIsFocused: () => false };

  return [isVisible, description, mock];
};
