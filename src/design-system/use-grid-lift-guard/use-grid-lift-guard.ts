import { useRef } from 'react';

type GridCardEvent = { key: string };

/**
 * Keeps a card from opening its page after a hold lifted it.
 *
 * react-native-sortables lifts a card once the hold passes its activation
 * delay, and the finger then lifting off still reaches the card's own `onPress`
 * — even when the card never moved, which is also the release after the
 * context menu opened. Wire `onDragStart` and `onActiveItemDropped` to the grid
 * and wrap each card's open handler in `openUnlessLifted`: a quick tap never
 * lifts, so it still opens.
 *
 * The flag is cleared by the press it suppressed, and again by the drop (the
 * library calls it after the release, a drop animation later), because a lift
 * can end without any press reaching the card.
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
