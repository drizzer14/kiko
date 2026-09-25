import { renderHook } from '@testing-library/react-native';

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
