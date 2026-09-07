import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';

import type { HoldingRow } from '../../../db/schema';
import * as colorSchemeModule from '../../../design-system/color-scheme';
import '../../../design-system/unistyles';
import { entityCardBackground } from '../../../design-system/entity-tint';
import { darkTheme } from '../../../design-system/theme';

import HoldingCard from './holding-card.component';

// HoldingCard subscribes to the native stack's `transitionEnd` event via
// `useNavigation` to know when the push slide-in has settled. The bare renders
// below mount the card outside any navigator, so `useNavigation` is mocked to a
// stub whose `addListener` records the handler. A module-level `mock`-prefixed
// spy is the factory-safe way to reach the captured handler back out (jest
// hoists the mock factory above the file's other bindings). The noop
// unsubscribe keeps the card's effect cleanup happy for every test that never
// drives the event.
type TransitionEndHandler = (e: { data?: { closing?: boolean } }) => void;
const mockAddListener = jest.fn<() => void, [string, TransitionEndHandler]>(() => () => {});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ addListener: mockAddListener }),
}));

// A minimal, valuable manual holding. holdingValue takes the default `flat`
// branch for a `card` type, so its value is just the stored balance.
const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Black card',
    type: 'card',
    currency: 'UAH',
    balanceMinorUnits: 100000,
    icon: null,
    metadata: null,
    ...overrides,
  }) as unknown as HoldingRow;

const NOW = Date.UTC(2024, 0, 1);

describe('HoldingCard', () => {
  beforeEach(() => {
    // Reset to the inert noop-unsubscribe default before each test; the settle
    // tests below override the implementation to capture the handler.
    mockAddListener.mockReset();
    mockAddListener.mockReturnValue(() => {});
  });

  it('renders the holding name and its computed value', async () => {
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );
    expect(getByText('Black card')).toBeTruthy();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('opens the holding detail on a plain tap', async () => {
    const onOpen = jest.fn();
    const { getByText } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={onOpen} />,
    );
    await fireEvent.press(getByText('Black card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('tints the icon with the holding stored color', async () => {
    const { getByLabelText } = await render(
      <HoldingCard
        holding={holding({ color: darkTheme.colors.entityColors.violet })}
        now={NOW}
        onOpen={jest.fn()}
      />,
    );

    expect(getByLabelText('Black card icon').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('falls back to the type default color when the holding has no stored color', async () => {
    const { getByLabelText } = await render(
      <HoldingCard holding={holding({ color: null })} now={NOW} onOpen={jest.fn()} />,
    );

    // A `card` holding with no color reads the card type default (white).
    expect(getByLabelText('Black card icon').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('washes the card with a flat darkened background of its stored color on first render', async () => {
    const { getByTestId } = await render(
      <HoldingCard
        holding={holding({ color: darkTheme.colors.entityColors.violet })}
        now={NOW}
        onOpen={jest.fn()}
      />,
    );

    const flat = StyleSheet.flatten(getByTestId('holding-card-wash').props.style);
    expect(flat.backgroundColor).toBe(entityCardBackground(darkTheme.colors.entityColors.violet));
  });

  it('washes the card with a flat darkened background of the type default color when it has no stored color', async () => {
    const { getByTestId } = await render(
      <HoldingCard holding={holding({ color: null })} now={NOW} onOpen={jest.fn()} />,
    );

    // A `card` holding with no color reads the card type default (white).
    const flat = StyleSheet.flatten(getByTestId('holding-card-wash').props.style);
    expect(flat.backgroundColor).toBe(entityCardBackground(darkTheme.colors.entityColors.white));
  });

  it('lightens the card tint on the light theme', async () => {
    jest.spyOn(colorSchemeModule, 'resolveColorScheme').mockReturnValue('light');
    try {
      const { getByTestId } = await render(
        <HoldingCard
          holding={holding({ color: darkTheme.colors.entityColors.violet })}
          now={NOW}
          onOpen={jest.fn()}
        />,
      );

      const flat = StyleSheet.flatten(getByTestId('holding-card-wash').props.style);
      expect(flat.backgroundColor).toBe(
        entityCardBackground(darkTheme.colors.entityColors.violet, 'light'),
      );
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('draws the shared hairline card border on first render (matches the account card, G2)', async () => {
    const { getByTestId } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );

    const cardStyle = StyleSheet.flatten(getByTestId('holding-card').props.style);
    expect(cardStyle.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(cardStyle.borderColor).toBe(darkTheme.colors.border);
  });

  it('renders as a wide row card (no square aspectRatio), mirroring the accounts card', async () => {
    const { getByTestId } = await render(
      <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
    );
    // The holding is now a full-width row (icon + name left, value right) in a
    // 1-column list, not a square tile — so the card carries no aspectRatio.
    const cardStyle = StyleSheet.flatten(getByTestId('holding-card').props.style);
    expect(cardStyle.aspectRatio).toBeUndefined();
  });

  // The vendor LiquidGlassView applies its native UIGlassEffect exactly once,
  // on its first layoutSubviews, then locks. On the pushed AccountDetail route
  // the card first lays out mid-slide at partial width, so that one-shot would
  // lock against the transient frame and the tint drifts. HoldingCard holds a
  // `settled` flag false until the native stack's `transitionEnd` (push finished,
  // `closing: false`) fires, then swaps the GlassSurface `key` — remounting the
  // native glass so its single locking layout lands at the settled full width.
  describe('settling the glass on the pushed route', () => {
    // Capture the `transitionEnd` handler the card registers so the test drives
    // the "push finished" moment itself, instead of racing a real transition.
    let fireTransitionEnd: TransitionEndHandler | undefined;
    let unsubscribe: jest.Mock;

    beforeEach(() => {
      fireTransitionEnd = undefined;
      unsubscribe = jest.fn();
      mockAddListener.mockImplementation((event, handler) => {
        if (event === 'transitionEnd') {
          fireTransitionEnd = handler;
        }
        return unsubscribe;
      });
    });

    it('subscribes to the native-stack transitionEnd event on mount', async () => {
      await render(<HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />);
      expect(mockAddListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));
    });

    it('remounts the GlassSurface (key flips) once the push transition settles', async () => {
      const { getByTestId } = await render(
        <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
      );

      // Before settling, the glass base is mounted against the (mid-slide)
      // initial key.
      const initialBase = getByTestId('holding-card-base');

      await act(async () => {
        fireTransitionEnd?.({ data: { closing: false } });
      });

      // The key change from 'initial' to 'settled' unmounts the old native glass
      // and mounts a fresh one, so the base host node is a brand-new instance —
      // proving the remount that lets the vendor effect re-run its one-shot on
      // settled geometry. Compared as a boolean, not `toBe`, so a failure never
      // asks jest to serialize the (circular) ReactTestInstance.
      const settledBase = getByTestId('holding-card-base');
      expect(settledBase === initialBase).toBe(false);
    });

    it('ignores a closing transitionEnd (the pop-away), leaving the glass untouched', async () => {
      const { getByTestId } = await render(
        <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
      );
      const initialBase = getByTestId('holding-card-base');

      await act(async () => {
        fireTransitionEnd?.({ data: { closing: true } });
      });

      // A closing transition is the card leaving; it must NOT flip `settled`, so
      // the glass keeps its original instance (no remount).
      expect(getByTestId('holding-card-base') === initialBase).toBe(true);
    });

    it('unsubscribes from the transitionEnd listener on unmount', async () => {
      const { unmount } = await render(
        <HoldingCard holding={holding()} now={NOW} onOpen={jest.fn()} />,
      );
      // Unmount inside act so React flushes the effect-cleanup (the unsubscribe)
      // before the assertion reads the call count.
      await act(async () => {
        unmount();
      });
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
