import { act, renderHook } from '@testing-library/react-native';
import type { Spec } from '@kiko/native-specs/NativeDisplayRegions';

import type { DisplayRegionsSnapshot } from '../display-regions-native';

import { useTabBarEdge } from '.';

type RefreshableSpec = jest.Mocked<Spec> & { requestRefresh: jest.Mock };

// Read through the registry, not a value import: only the wrapper may load
// the native module. The shared stub has no requestRefresh, so each test installs its own.
const nativeModule = (
  jest.requireMock('@kiko/native-specs/NativeDisplayRegions') as { default: RefreshableSpec }
).default;

const snapshotWithEdge = (tabBarEdge: DisplayRegionsSnapshot['tabBarEdge']): string =>
  JSON.stringify({
    horizontalSizeClass: 'regular',
    verticalBarEdge: 'none',
    tabBarEdge,
    foldRegion: null,
  } satisfies DisplayRegionsSnapshot);

beforeEach(() => {
  nativeModule.requestRefresh = jest.fn();
  nativeModule.getSnapshot.mockReturnValue(snapshotWithEdge('none'));
});

describe('useTabBarEdge', () => {
  it('reads top from the snapshot', async () => {
    nativeModule.getSnapshot.mockReturnValue(snapshotWithEdge('top'));

    const { result } = await renderHook(() => useTabBarEdge());

    expect(result.current).toBe('top');
  });

  it('re-renders to bottom on an onChange payload (Duo inner portrait)', async () => {
    let emit: (payload: string) => void = () => undefined;
    nativeModule.onChange.mockImplementationOnce((handler) => {
      emit = handler;

      return { remove: jest.fn() };
    });
    nativeModule.getSnapshot.mockReturnValue(snapshotWithEdge('none'));
    const { result } = await renderHook(() => useTabBarEdge());

    expect(result.current).toBe('none');

    await act(async () => {
      emit(snapshotWithEdge('bottom'));
    });

    expect(result.current).toBe('bottom');
  });

  it('asks for one refresh per mount, none per re-render', async () => {
    const { rerender } = await renderHook(() => useTabBarEdge());

    await rerender(undefined);
    await rerender(undefined);

    expect(nativeModule.requestRefresh).toHaveBeenCalledTimes(1);
  });
});
