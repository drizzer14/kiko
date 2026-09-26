import { act, renderHook } from '@testing-library/react-native';

import { useSubmitOnce } from './use-submit-once';

describe('useSubmitOnce', () => {
  it('runs the submit once for two synchronous presses', async () => {
    let resolveSubmit: () => void = () => {};
    const submit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    const { result } = await renderHook(() => useSubmitOnce(submit));

    await act(() => {
      result.current.onPress();
      result.current.onPress();
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSubmit();
    });

    expect(result.current.isSubmitting).toBe(false);
  });

  it('re-arms after the submit settles', async () => {
    const submit = jest.fn(() => Promise.resolve());
    const { result } = await renderHook(() => useSubmitOnce(submit));

    await act(async () => {
      result.current.onPress();
    });
    await act(async () => {
      result.current.onPress();
    });

    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('re-arms after the submit rejects', async () => {
    const submit = jest.fn(() => Promise.reject(new Error('nope')));
    const { result } = await renderHook(() => useSubmitOnce(submit));

    await act(async () => {
      result.current.onPress();
    });

    expect(result.current.isSubmitting).toBe(false);

    // A direct retry proof, not only the state flag: the guard must actually
    // let a second, real press through after a failed submit, not merely
    // report `isSubmitting: false` while still silently swallowing the retry.
    await act(async () => {
      result.current.onPress();
    });

    expect(submit).toHaveBeenCalledTimes(2);
  });
});
