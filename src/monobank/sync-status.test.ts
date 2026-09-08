import { getSnapshot, setSyncing, subscribe } from './sync-status';

describe('sync-status store', () => {
  // Module-level singleton state: reset it after each test so one test's flag
  // never leaks into the next.
  afterEach(() => {
    setSyncing(false);
  });

  it('starts not syncing', () => {
    expect(getSnapshot()).toBe(false);
  });

  it('reflects setSyncing in the snapshot', () => {
    setSyncing(true);
    expect(getSnapshot()).toBe(true);

    setSyncing(false);
    expect(getSnapshot()).toBe(false);
  });

  it('notifies a subscribed listener when the flag changes', () => {
    const listener = jest.fn();
    subscribe(listener);

    setSyncing(true);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the value is unchanged (idempotent set)', () => {
    const listener = jest.fn();
    subscribe(listener);

    setSyncing(false); // already false
    expect(listener).not.toHaveBeenCalled();

    setSyncing(true);
    setSyncing(true); // still true — no second notification
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribe(listener);

    unsubscribe();
    setSyncing(true);

    expect(listener).not.toHaveBeenCalled();
  });
});
