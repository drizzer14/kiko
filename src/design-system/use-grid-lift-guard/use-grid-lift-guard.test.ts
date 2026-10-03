import { renderHook } from '@testing-library/react-native';

import { useGridLiftGuard } from './use-grid-lift-guard';

describe('useGridLiftGuard', () => {
  it('opens on a quick tap, when no card was lifted', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.openUnlessLifted('a', open)();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not open a card that was lifted, even when the finger ends in place', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.onDragStart({ key: 'a' });
    result.current.openUnlessLifted('a', open)();

    expect(open).not.toHaveBeenCalled();
  });

  it('opens on the next quick tap once the suppressed release has been consumed', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.onDragStart({ key: 'a' });
    result.current.openUnlessLifted('a', open)();
    result.current.openUnlessLifted('a', open)();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens on a quick tap after the drop, when the lift never produced a press', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.onDragStart({ key: 'a' });
    result.current.onActiveItemDropped({ key: 'a' });
    result.current.openUnlessLifted('a', open)();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps suppressing the lifted card when a different card is dropped', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.onDragStart({ key: 'a' });
    result.current.onActiveItemDropped({ key: 'b' });
    result.current.openUnlessLifted('a', open)();

    expect(open).not.toHaveBeenCalled();
  });

  it('still opens a card that was not the lifted one', async () => {
    const { result } = await renderHook(() => useGridLiftGuard());
    const open = jest.fn();

    result.current.onDragStart({ key: 'a' });
    result.current.openUnlessLifted('b', open)();

    expect(open).toHaveBeenCalledTimes(1);
  });
});
