import { useRef } from 'react';

type GridCardEvent = { key: string };

/**
 * Keeps a card from opening its page after a hold lifted it.
 *
 * react-native-sortables lifts a card once the hold passes its activation
 * delay. A moved drag and an opened context menu deliver no `onPress` (RNGH
 * cancels the JS responder when its gesture activates). The press reaches JS
 * only on a still hold released before the menu, with no touch-move after the
 * lift, because the v3 gesture-handler adapter activates on the next move. Wire
 * `onDragStart` and `onActiveItemDropped` to the grid and wrap each card's open
 * handler in `openUnlessLifted`: a quick tap never lifts, so it still opens.
 *
 * The flag is cleared by the press it suppressed, and again by the drop (the
 * library calls it after the release, a drop animation later), which covers
 * every other case, where no press reaches the card.
 */
export const useGridLiftGuard = (): {
  onDragStart: (event: GridCardEvent) => void;
  onActiveItemDropped: (event: GridCardEvent) => void;
  openUnlessLifted: (key: string, open: () => void) => () => void;
} => {
  const liftedKey = useRef<string | undefined>(undefined);

  const onDragStart = ({ key }: GridCardEvent): void => {
    liftedKey.current = key;
  };

  const onActiveItemDropped = ({ key }: GridCardEvent): void => {
    if (liftedKey.current === key) {
      liftedKey.current = undefined;
    }
  };

  const openUnlessLifted = (key: string, open: () => void) => (): void => {
    if (liftedKey.current === key) {
      liftedKey.current = undefined;

      return;
    }

    open();
  };

  return { onDragStart, onActiveItemDropped, openUnlessLifted };
};
