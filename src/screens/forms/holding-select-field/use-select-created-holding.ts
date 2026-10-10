import { useContext, useEffect, useRef } from 'react';
import { NavigationContext } from '@react-navigation/native';

import type { HoldingSelectOption } from './holding-select-field.props';

const MILLISECONDS_PER_SECOND = 1_000;

type RoundTrip = {
  startedAt: number;
  // Set when the picker's screen regains focus, which closes the window; a
  // holding created after that instant belongs to something else.
  returnedAt: number | undefined;
};

// The `created_at` column holds whole seconds (rounded down), so a holding
// saved in the same second as the press carries a stamp BEFORE the press. The
// same precision limit applies at the window's end: a holding stamped up to
// about one second after the user cancelled can still fall inside the window
// and be selected. That is inherent to a whole-second stamp, and it only
// preselects a visible form value; it writes no data.
const floorToSecond = (instant: number): number =>
  Math.floor(instant / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND;

const wasCreatedDuring = (option: HoldingSelectOption, roundTrip: RoundTrip): boolean =>
  option.createdAt >= floorToSecond(roundTrip.startedAt) &&
  (roundTrip.returnedAt === undefined || option.createdAt <= roundTrip.returnedAt);

// Selects the holding the user created through an empty picker's "Add holding"
// row. The returned function starts the round trip (call it when the row is
// pressed); the first option stamped inside the window between that press and
// the screen regaining focus is then handed to `onSelect`, once. The window is
// what keeps a holding that a sync adds after the user cancelled the create
// form from being selected into the field. Focus is read from the screen's own
// navigation, because the new option can reach this field before or after the
// focus event. Outside a navigator (only a test renders the field that way) the
// window never closes, so the first option stamped after the press is selected.
export const useSelectCreatedHolding = (
  options: readonly HoldingSelectOption[],
  onSelect: (id: string) => void,
): (() => void) => {
  const navigation = useContext(NavigationContext);
  const roundTrip = useRef<RoundTrip | undefined>(undefined);

  useEffect(
    () =>
      navigation?.addListener('focus', () => {
        if (roundTrip.current !== undefined && roundTrip.current.returnedAt === undefined) {
          roundTrip.current = { ...roundTrip.current, returnedAt: Date.now() };
        }
      }),
    [navigation],
  );

  useEffect(() => {
    const pending = roundTrip.current;

    if (pending === undefined) {
      return;
    }

    const created = options.find((option) => wasCreatedDuring(option, pending));

    if (created !== undefined) {
      roundTrip.current = undefined;
      onSelect(created.id);
    }
  }, [options, onSelect]);

  return () => {
    roundTrip.current = { startedAt: Date.now(), returnedAt: undefined };
  };
};
