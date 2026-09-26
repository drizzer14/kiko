import { useCallback, useRef, useState } from 'react';

/**
 * Runs an async submit at most once per in-flight period, and reports whether
 * one is running so the Save button can render disabled.
 *
 * WHY A REF AND NOT ONLY STATE: every form's `save` awaits its write before
 * calling `navigation.goBack()`, so a second tap inside that window re-reads
 * the same component state and writes again — a doubled deposit contribution
 * (principal AND every derived interest/tax line), a duplicate transaction
 * with the balance adjusted twice, a duplicate holding/account row. Two taps
 * in the same tick both observe the same pre-render `isSubmitting` value, so a
 * state-only guard lets the second through; the ref is read and written
 * synchronously and is what actually closes the window. `isSubmitting` state
 * exists only to drive the disabled prop.
 *
 * This is the account-detail sync button's `inFlight` ref pattern
 * (`src/screens/account-detail/account-detail.screen.tsx`), extracted so the
 * four forms share one implementation instead of four copies.
 */
export const useSubmitOnce = (
  submit: () => Promise<void>,
): { onPress: () => void; isSubmitting: boolean } => {
  const inFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onPress = useCallback((): void => {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setIsSubmitting(true);

    // The submit's own error handling stays where it is (each form shows its
    // own Alert or keeps its screen open), so this only has to re-arm — on
    // success AND on failure, so a failed save can be retried.
    const settle = (): void => {
      inFlight.current = false;
      setIsSubmitting(false);
    };

    submit().then(settle, settle);
  }, [submit]);

  return { onPress, isSubmitting };
};
