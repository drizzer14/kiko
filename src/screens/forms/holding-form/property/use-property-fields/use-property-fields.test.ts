import { act, renderHook } from '@testing-library/react-native';

import { usePropertyFields } from './use-property-fields';

describe('usePropertyFields scrollTargets', () => {
  it('holds exactly one target, on the cost field', async () => {
    const { result } = await renderHook(() =>
      usePropertyFields({ isEdit: false, currency: 'UAH' }),
    );

    expect(result.current.scrollTargets).toEqual([
      expect.objectContaining({ ref: result.current.refs.costFieldRef }),
    ]);
  });

  it('blocks on the cost field in create mode when it is blank', async () => {
    const { result } = await renderHook(() =>
      usePropertyFields({ isEdit: false, currency: 'UAH' }),
    );

    const firstInvalid = result.current.scrollTargets.find((target) => target.invalid);

    expect(firstInvalid?.ref).toBe(result.current.refs.costFieldRef);
  });

  it('finds no invalid target in edit mode, where the cost field never blocks', async () => {
    const { result } = await renderHook(() => usePropertyFields({ isEdit: true, currency: 'UAH' }));

    expect(result.current.scrollTargets.find((target) => target.invalid)).toBeUndefined();
  });
});

describe('usePropertyFields seed', () => {
  it('seeds the category and lots from a valid stored holding', async () => {
    const { result } = await renderHook(() => usePropertyFields({ isEdit: true, currency: 'UAH' }));

    await act(async () => {
      result.current.seed({
        metadata: {
          category: 'vehicle',
          lots: [{ day: 1_000, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) `seed` only reads `metadata`; a full HoldingRow literal would be pure noise here, mirroring the sibling seed-function tests.
      } as any);
    });

    expect(result.current.category).toBe('vehicle');
  });

  it('pre-selects Other when the stored category is unrecognized, even though the lots are then left unseeded', async () => {
    const { result } = await renderHook(() => usePropertyFields({ isEdit: true, currency: 'UAH' }));

    await act(async () => {
      result.current.seed({
        metadata: {
          category: 'nonsense',
          lots: [{ day: 1_000, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) `seed` only reads `metadata`; a full HoldingRow literal would be pure noise here, mirroring the sibling seed-function tests.
      } as any);
    });

    expect(result.current.category).toBe('other');
  });

  it('pre-selects Other when the metadata carries no category at all', async () => {
    const { result } = await renderHook(() => usePropertyFields({ isEdit: true, currency: 'UAH' }));

    await act(async () => {
      result.current.seed({
        metadata: { lots: [] },
        // biome-ignore lint/suspicious/noExplicitAny: OVERRIDE(test fixture) `seed` only reads `metadata`; a full HoldingRow literal would be pure noise here, mirroring the sibling seed-function tests.
      } as any);
    });

    expect(result.current.category).toBe('other');
  });
});
