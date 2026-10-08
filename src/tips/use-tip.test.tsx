import { act, renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

const mockDismissTip = jest.fn();
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    dismissTip: (...args: unknown[]) => mockDismissTip(...args),
  },
}));

import { useTip } from './use-tip';

const settled = (dismissedTips: string[]): void => {
  mockUseLiveQuery.mockReturnValue({ data: [{ dismissedTips }], isLoading: false });
};

describe('useTip', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    mockDismissTip.mockReset();
    mockDismissTip.mockResolvedValue(undefined);
  });

  it('reads the settings table with the cached option', async () => {
    settled([]);

    await renderHook(() => useTip('settings.categories', true));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['settings'], true, {
      cached: true,
    });
  });

  it('is not visible while the settings query is loading, even when nothing is dismissed', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: true });

    const { result } = await renderHook(() => useTip('settings.categories', true));

    expect(result.current.visible).toBe(false);
  });

  it('is visible when the condition holds and the tip is not dismissed', async () => {
    settled(['transaction.applyToAll']);

    const { result } = await renderHook(() => useTip('settings.categories', true));

    expect(result.current.visible).toBe(true);
  });

  it('is visible on a settled query with no settings row', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    const { result } = await renderHook(() => useTip('settings.categories', true));

    expect(result.current.visible).toBe(true);
  });

  it('is not visible when the tip is dismissed', async () => {
    settled(['settings.categories']);

    const { result } = await renderHook(() => useTip('settings.categories', true));

    expect(result.current.visible).toBe(false);
  });

  it('is not visible when the condition is false', async () => {
    settled([]);

    const { result } = await renderHook(() => useTip('settings.categories', false));

    expect(result.current.visible).toBe(false);
  });

  it('dismiss records the tip once', async () => {
    settled([]);

    const { result } = await renderHook(() => useTip('settings.categories', true));
    await act(async () => {
      result.current.dismiss();
    });

    expect(mockDismissTip).toHaveBeenCalledTimes(1);
    expect(mockDismissTip).toHaveBeenCalledWith('settings.categories');
  });
});
