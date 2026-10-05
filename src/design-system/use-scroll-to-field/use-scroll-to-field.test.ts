import * as reanimated from 'react-native-reanimated';
import { renderHook } from '@testing-library/react-native';
import { scrollToField, useHeaderInset } from '@kiko/design-system/scroll-to-field';

import { useScrollToField } from './use-scroll-to-field';

jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const scrollToFieldMock = scrollToField as jest.Mock;

describe('useScrollToField', () => {
  beforeEach(() => {
    (useHeaderInset as jest.Mock).mockReturnValue(96);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands the scroll ref, the field ref and the settle callback to scrollToField', async () => {
    const { result } = await renderHook(() => useScrollToField());
    const fieldRef = { current: null };
    const onSettled = jest.fn();

    result.current.scrollTo(fieldRef, onSettled);

    expect(scrollToFieldMock).toHaveBeenCalledTimes(1);
    const [scrollableRef, targetRef, , settled] = scrollToFieldMock.mock.calls[0];
    expect(scrollableRef).toBe(result.current.scrollableRef);
    expect(targetRef).toBe(fieldRef);
    expect(settled).toBe(onSettled);
  });

  it('passes no settle callback when the caller gives none', async () => {
    const { result } = await renderHook(() => useScrollToField());

    result.current.scrollTo({ current: null });

    expect(scrollToFieldMock.mock.calls[0][3]).toBeUndefined();
  });

  it('reports the live header inset and an unmeasured content height of 0', async () => {
    const { result } = await renderHook(() => useScrollToField());

    result.current.scrollTo({ current: null });

    expect(scrollToFieldMock.mock.calls[0][2]).toEqual({
      currentOffset: 0,
      headerInset: 96,
      contentHeight: 0,
    });
  });

  it('reports the content height last seen through onContentSizeChange without a re-render', async () => {
    const { result } = await renderHook(() => useScrollToField());
    const { scrollTo } = result.current;

    result.current.onContentSizeChange(320, 640);
    scrollTo({ current: null });

    expect(scrollToFieldMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({ contentHeight: 640 }),
    );
  });

  it('reads the scroll offset at call time, not at render time', async () => {
    const offset = { value: 0 };
    jest.spyOn(reanimated, 'useScrollOffset').mockReturnValue(offset as never);
    const { result } = await renderHook(() => useScrollToField());
    const { scrollTo } = result.current;

    offset.value = 250;
    scrollTo({ current: null });

    expect(scrollToFieldMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({ currentOffset: 250 }),
    );
  });
});
