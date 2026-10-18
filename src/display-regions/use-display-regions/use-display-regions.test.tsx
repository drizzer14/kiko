import { act, renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { DisplayRegionsSnapshot } from '../display-regions-native';

import { useDisplayRegions } from '.';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: Spec }).default,
);

const flatSnapshot: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'compact',
  verticalBarEdge: 'none',
  tabBarEdge: 'none',
  foldRegion: null,
};

const duoSnapshot: DisplayRegionsSnapshot = {
  horizontalSizeClass: 'regular',
  verticalBarEdge: 'leading',
  tabBarEdge: 'trailing',
  foldRegion: { x: 470, y: 0, width: 11, height: 669 },
};

beforeEach(() => {
  nativeModule.getSnapshot.mockReturnValue(JSON.stringify(flatSnapshot));
});

describe('useDisplayRegions', () => {
  it('returns the snapshot the native module reports', async () => {
    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));

    const { result } = await renderHook(() => useDisplayRegions());

    expect(result.current).toEqual(duoSnapshot);
  });

  it('re-renders with the new snapshot when the native side emits a change', async () => {
    let emit: (payload: string) => void = () => undefined;
    nativeModule.onChange.mockImplementationOnce((handler) => {
      emit = handler;

      return { remove: jest.fn() };
    });
    const { result } = await renderHook(() => useDisplayRegions());

    expect(result.current).toEqual(flatSnapshot);

    nativeModule.getSnapshot.mockReturnValue(JSON.stringify(duoSnapshot));
    await act(async () => {
      emit(JSON.stringify(duoSnapshot));
    });

    expect(result.current).toEqual(duoSnapshot);
  });

  it('unsubscribes from the native module on unmount', async () => {
    const remove = jest.fn();
    nativeModule.onChange.mockReturnValueOnce({ remove });
    const { unmount } = await renderHook(() => useDisplayRegions());

    expect(remove).not.toHaveBeenCalled();

    await unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('renders once for an unchanged snapshot, with no render loop', async () => {
    let renderCount = 0;

    await renderHook(() => {
      renderCount += 1;

      return useDisplayRegions();
    });

    expect(renderCount).toBe(1);
  });

  it('makes one native read for the first render and one on subscribe, however often it renders', async () => {
    const { rerender } = await renderHook(() => useDisplayRegions());

    await rerender(undefined);
    await rerender(undefined);
    await rerender(undefined);

    expect(nativeModule.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reads the native module once for every consumer mounted together', async () => {
    await renderHook(() => [useDisplayRegions(), useDisplayRegions(), useDisplayRegions()]);

    expect(nativeModule.getSnapshot).toHaveBeenCalledTimes(2);
  });
});
