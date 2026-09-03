import { act, renderHook } from '@testing-library/react-native';
import { nextOpenCount, useSwipePopGuard } from './use-swipe-pop-guard';

// The native-stack interactive back-swipe is a native gesture a JS
// PanResponder cannot cancel. While ANY swipe row on the screen is open, the
// guard disables the screen's native pop gesture, and re-enables it only once
// the LAST open row closes — so a right-swipe that closes a row never also
// pops the screen. The screen passes its own `navigation`, so the hook needs
// no NavigationContainer under test — a stub with setOptions is enough.
const stubNavigation = () => ({ setOptions: jest.fn() });

describe('nextOpenCount', () => {
  it('increments the open-row count when a row opens', () => {
    expect(nextOpenCount(0, true)).toBe(1);
    expect(nextOpenCount(2, true)).toBe(3);
  });

  it('decrements the open-row count when a row closes', () => {
    expect(nextOpenCount(2, false)).toBe(1);
    expect(nextOpenCount(1, false)).toBe(0);
  });

  it('floors at zero so a spurious close never drives the count negative', () => {
    expect(nextOpenCount(0, false)).toBe(0);
  });
});

describe('useSwipePopGuard', () => {
  it('disables the native pop gesture the moment the first row opens', async () => {
    const navigation = stubNavigation();
    const { result } = await renderHook(() => useSwipePopGuard(navigation));

    await act(async () => {
      result.current(true);
    });
    expect(navigation.setOptions).toHaveBeenCalledTimes(1);
    expect(navigation.setOptions).toHaveBeenCalledWith({
      gestureEnabled: false,
      fullScreenGestureEnabled: false,
    });
  });

  it('keeps the gesture disabled while any row stays open, re-enabling only on the last close', async () => {
    const navigation = stubNavigation();
    const { result } = await renderHook(() => useSwipePopGuard(navigation));

    await act(async () => {
      result.current(true);
    });
    navigation.setOptions.mockClear();

    // A second row on the same screen opens: the gesture is already disabled,
    // so the guard must not toggle it again.
    await act(async () => {
      result.current(true);
    });
    expect(navigation.setOptions).not.toHaveBeenCalled();

    // One of the two rows closes: one row is still open, so the gesture stays
    // disabled.
    await act(async () => {
      result.current(false);
    });
    expect(navigation.setOptions).not.toHaveBeenCalled();

    // The last open row closes: the gesture is restored exactly once.
    await act(async () => {
      result.current(false);
    });
    expect(navigation.setOptions).toHaveBeenCalledTimes(1);
    expect(navigation.setOptions).toHaveBeenCalledWith({
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
    });
  });

  // A row deleted while open emits its closing `false` from an unmount cleanup
  // rather than a settle-closed. From the guard's view that is an ordinary
  // open-then-close pair, so the tally returns to 0 and the native back-swipe
  // is restored — the open-while-unmounting row does not strand it disabled.
  it('re-enables the gesture when an opened row reports its close on unmount', async () => {
    const navigation = stubNavigation();
    const { result } = await renderHook(() => useSwipePopGuard(navigation));

    // The row opens (guard disables the gesture)...
    await act(async () => {
      result.current(true);
    });
    // ...then unmounts while open, emitting the balancing close.
    await act(async () => {
      result.current(false);
    });

    expect(navigation.setOptions).toHaveBeenCalledTimes(2);
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
    });
  });
});
