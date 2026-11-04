import { renderHook } from '@testing-library/react-native';

const mockBackfillMccCategories = jest.fn().mockResolvedValue(undefined);
jest.mock('./backfill-mcc-categories', () => ({
  backfillMccCategories: () => mockBackfillMccCategories(),
}));

import { useMccBackfill } from './use-mcc-backfill';

describe('useMccBackfill', () => {
  it('runs the back-fill once, after the first render, and not on a re-render', async () => {
    const rendered = await renderHook(() => useMccBackfill());

    expect(mockBackfillMccCategories).toHaveBeenCalledTimes(1);

    await rendered.rerender({});

    expect(mockBackfillMccCategories).toHaveBeenCalledTimes(1);
  });
});
