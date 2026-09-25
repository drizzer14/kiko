import { act, renderHook } from '@testing-library/react-native';

import { useMetalFields } from './use-metal-fields';

describe('useMetalFields scrollTargets', () => {
  it('orders scrollTargets purity, quantity, cost, each on its own ref', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));
    const { refs } = result.current;

    expect(result.current.scrollTargets.map((target) => target.ref)).toEqual([
      refs.purityFieldRef,
      refs.quantityFieldRef,
      refs.costFieldRef,
    ]);
  });

  it('blocks on the quantity field first in create mode, since the default purity is already valid', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid?.ref).toBe(result.current.refs.quantityFieldRef);
  });

  it('blocks on the purity field first once purity itself is out of range, ahead of quantity/cost', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    await act(async () => {
      result.current.setPurity('2');
    });

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid?.ref).toBe(result.current.refs.purityFieldRef);
  });

  it('finds no invalid target in edit mode, where quantity/cost never block', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: true }));

    expect(result.current.scrollTargets.find((target) => target.invalid)).toBeUndefined();
  });
});
