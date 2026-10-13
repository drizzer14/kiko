import { type FC, useEffect, useState } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { ActivityIndicator, View } from 'react-native';

import { styles } from './loading-state.styles';
import type { LoadingStateProps } from './loading-state.props';

/**
 * How long a `LoadingState` waits before showing its spinner. The op-sqlite
 * single-worker-thread queueing (`kiko-architecture`) means MOST first reads
 * settle well under this, so a screen that resolves quickly never flashes a
 * spinner at all — only a genuinely slow first read (queued behind an
 * app-open write burst) shows one. Never change readiness semantics for
 * this: the screen stays gated on `useDataReady`; only the VISUAL spinner is
 * delayed.
 */
export const SPINNER_DELAY_MS = 200;

/**
 * The shared "this screen's own data has not loaded yet" visual: a plain
 * centered native spinner, no text at all — a `useDataReady` consumer
 * (`kiko-architecture`'s useLiveQuery consumer rule) renders this in place
 * of its own empty state (empty list text, empty chart, zero balance)
 * while any of its live queries is still on its first load, and a spinner
 * needs no i18n string, so gating a screen this way never adds one. The
 * spinner itself is delayed by `SPINNER_DELAY_MS`: the container (the plain
 * background) renders immediately, but the `ActivityIndicator` only mounts
 * once the delay elapses, so a fast load never flickers a spinner.
 */
const LoadingState: FC<LoadingStateProps> = ({ testID }) => {
  const { theme } = useUnistyles();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View testID={testID} style={styles.container}>
      {showSpinner && (
        <ActivityIndicator
          testID={testID ? `${testID}-spinner` : undefined}
          color={theme.colors.textSecondary}
        />
      )}
    </View>
  );
};

export default LoadingState;
