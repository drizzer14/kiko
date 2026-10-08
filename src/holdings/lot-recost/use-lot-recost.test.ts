import { renderHook } from '@testing-library/react-native';

import { useLotRecost } from './use-lot-recost';

const mockRecostStoredLots = jest.fn().mockResolvedValue(undefined);
jest.mock('./lot-recost', () => ({
  recostStoredLots: () => mockRecostStoredLots(),
}));

describe('useLotRecost', () => {
  it('runs the recost once, after the first render, and not on a re-render', async () => {
    const rendered = await renderHook(() => useLotRecost());

    expect(mockRecostStoredLots).toHaveBeenCalledTimes(1);

    await rendered.rerender({});

    expect(mockRecostStoredLots).toHaveBeenCalledTimes(1);
  });
});
