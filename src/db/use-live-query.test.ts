import { renderHook } from '@testing-library/react-native';
import { useLiveQuery } from './use-live-query';

const mockUnsubscribe = jest.fn();
const mockReactiveExecute = jest.fn();

// jest's mock-hoisting guard only allows module-factory closures to
// reference variables prefixed with `mock` (case-insensitive) — see
// babel-plugin-jest-hoist. Renamed from the brief's `unsubscribe` /
// `reactiveExecute` to satisfy that, same behavior.
jest.mock('./client', () => ({
  rawDatabase: {
    reactiveExecute: (config: { callback: (r: { rows: unknown[] }) => void }) => {
      mockReactiveExecute(config);
      config.callback({ rows: [{ id: 'a' }] });
      return mockUnsubscribe;
    },
  },
}));

const fakeQuery = { toSQL: () => ({ sql: 'SELECT * FROM accounts', params: [] }) };

describe('useLiveQuery', () => {
  it('subscribes and exposes the first result set', async () => {
    // @testing-library/react-native 14.x's renderHook is async (it
    // internally awaits `act`, required for React 19's concurrent
    // rendering) — the brief's synchronous call form predates this.
    const { result } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    expect(mockReactiveExecute).toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderHook(() => useLiveQuery(fakeQuery, ['accounts']));
    await unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
