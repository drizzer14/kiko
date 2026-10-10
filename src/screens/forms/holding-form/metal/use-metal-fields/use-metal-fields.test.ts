import { act, renderHook } from '@testing-library/react-native';

import { type MetalFieldsDraft, useMetalFields } from './use-metal-fields';

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
      result.current.setPurity('1001');
    });

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid?.ref).toBe(result.current.refs.purityFieldRef);
  });

  it('finds no invalid target in edit mode, where quantity/cost never block', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: true }));

    expect(result.current.scrollTargets.find((target) => target.invalid)).toBeUndefined();
  });
});

describe('useMetalFields purity in fineness per mille', () => {
  it('pre-fills the standard 999.9 fineness', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    expect(result.current.purity).toBe('999.9');
  });

  it.each([
    ['999.9', '0.9999'],
    ['999,9', '0.9999'],
    ['585', '0.585'],
    ['1000', '1'],
  ])('stores a %s fineness as the %s ratio', async (fineness, stored) => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    await act(async () => {
      result.current.setPurity(fineness);
      result.current.setQuantity('1');
      result.current.setCost('100');
    });

    expect(result.current.createPayload().metadata).toMatchObject({ purity: stored });
  });

  it('shows a stored ratio as its fineness', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: true }));

    await act(async () => {
      result.current.seed({
        id: 'h1',
        currency: 'UAH',
        metadata: { metal: 'XAU', form: 'bar', unit: 'oz', purity: '0.9990', lots: [] },
        // `seed` only reads `metadata`; a full HoldingRow literal would be noise.
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture)
      } as any);
    });

    expect(result.current.purity).toBe('999');
  });
});

describe('useMetalFields draft', () => {
  const filled: MetalFieldsDraft = {
    metal: 'XAG',
    form: 'coin',
    unit: 'g',
    purity: '925',
    quantity: '31.1',
    cost: '80 000',
  };

  it('holds a blank metal as it opens', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    expect(result.current.draft).toEqual({
      metal: 'XAU',
      form: 'bar',
      unit: 'oz',
      purity: '999.9',
      quantity: '',
      cost: '',
    });
  });

  it('brings back every field', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));

    await act(async () => {
      result.current.restore(filled);
    });

    expect(result.current.draft).toEqual(filled);
    expect(result.current.metal).toBe('XAG');
  });

  it('leaves the stored lots of an edit alone: they are read again, not kept in a draft', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: true }));

    await act(async () => {
      result.current.restore(filled);
    });

    expect(result.current.draft).not.toHaveProperty('lots');
  });

  it('keeps one restore across renders, so the screen effect that depends on it runs once', async () => {
    const { result } = await renderHook(() => useMetalFields({ isEdit: false }));
    const first = result.current.restore;

    await act(async () => {
      result.current.setQuantity('5');
    });

    expect(result.current.restore).toBe(first);
  });
});
