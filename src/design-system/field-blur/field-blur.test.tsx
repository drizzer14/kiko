import { renderHook } from '@testing-library/react-native';

import { FieldBlurContext, useFieldBlur } from '.';

describe('useFieldBlur', () => {
  it('hands back the own handler untouched outside a form that listens', async () => {
    const own = jest.fn();
    const { result } = await renderHook(() => useFieldBlur(own));

    expect(result.current).toBe(own);
  });

  it('hands back nothing outside a form that listens, for a field with no handler', async () => {
    const { result } = await renderHook(() => useFieldBlur(undefined));

    expect(result.current).toBeUndefined();
  });

  it('runs the own handler and then tells the form that listens', async () => {
    const calls: string[] = [];
    const own = jest.fn(() => calls.push('own'));
    const listener = jest.fn(() => calls.push('form'));
    const { result } = await renderHook(() => useFieldBlur(own), {
      wrapper: ({ children }) => (
        <FieldBlurContext.Provider value={listener}>{children}</FieldBlurContext.Provider>
      ),
    });

    result.current?.({} as never);

    expect(calls).toEqual(['own', 'form']);
  });

  it('tells the form that listens for a field with no handler of its own', async () => {
    const listener = jest.fn();
    const { result } = await renderHook(() => useFieldBlur(undefined), {
      wrapper: ({ children }) => (
        <FieldBlurContext.Provider value={listener}>{children}</FieldBlurContext.Provider>
      ),
    });

    result.current?.({} as never);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
