import { renderHook } from '@testing-library/react-native';

import { useIsMounted } from './use-is-mounted';

describe('useIsMounted', () => {
  it('answers true while the component is mounted', async () => {
    const { result } = await renderHook(() => useIsMounted());

    expect(result.current()).toBe(true);
  });

  it('answers false during the first render, before the mount effect ran', async () => {
    const answers: boolean[] = [];

    await renderHook(() => {
      const isMounted = useIsMounted();
      answers.push(isMounted());

      return isMounted;
    });

    expect(answers[0]).toBe(false);
  });

  it('answers false once the component unmounted', async () => {
    const { result, unmount } = await renderHook(() => useIsMounted());

    await unmount();

    expect(result.current()).toBe(false);
  });

  it('hands back the same function on every render', async () => {
    const { result, rerender } = await renderHook(() => useIsMounted());
    const first = result.current;

    await rerender({});

    expect(result.current).toBe(first);
  });
});
