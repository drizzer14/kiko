import { renderHook } from '@testing-library/react-native';

import { isSavedDraft, useDraftParam } from '.';

type Draft = { amount: string; note: string };

const FILLED: Draft = { amount: '12', note: 'tea' };

const renderDraftParam = async (draft: Draft | undefined) => {
  const setParams = jest.fn();
  const hook = await renderHook(
    ({ saved }: { saved: Draft | undefined }) =>
      useDraftParam<Draft>({ setParams }, { params: { draft: saved } }),
    { initialProps: { saved: draft } },
  );

  return { setParams, ...hook };
};

describe('isSavedDraft', () => {
  it('tells a draft marked saved from the identity a swap carries', () => {
    expect(isSavedDraft({ saved: true, name: 'Wallet' })).toBe(true);
    expect(isSavedDraft({ name: 'Wallet' })).toBe(false);
  });

  it('is false for no draft at all', () => {
    expect(isSavedDraft(undefined)).toBe(false);
  });
});

describe('useDraftParam', () => {
  it('reads the initial draft from the route params', async () => {
    const { result } = await renderDraftParam(FILLED);

    expect(result.current.initialDraft).toEqual(FILLED);
  });

  it('has no initial draft on a route that carries none', async () => {
    const { result } = await renderDraftParam(undefined);

    expect(result.current.initialDraft).toBeUndefined();
  });

  it('has no initial draft when the route has no params at all', async () => {
    const { result } = await renderHook(() => useDraftParam<Draft>({ setParams: jest.fn() }, {}));

    expect(result.current.initialDraft).toBeUndefined();
  });

  it('keeps the draft the screen mounted with, whatever the route holds later', async () => {
    const { result, rerender } = await renderDraftParam(FILLED);

    await rerender({ saved: { amount: '99', note: 'later' } });

    expect(result.current.initialDraft).toEqual(FILLED);
  });

  it('writes the draft onto the route params with one setParams per save', async () => {
    const { result, setParams } = await renderDraftParam(undefined);

    await result.current.saveDraft(FILLED);

    expect(setParams).toHaveBeenCalledTimes(1);
    expect(setParams).toHaveBeenCalledWith({ draft: FILLED });
  });

  it('keeps one saveDraft across renders, so an effect that depends on it does not re-run', async () => {
    const { result, rerender } = await renderDraftParam(undefined);
    const first = result.current.saveDraft;

    await rerender({ saved: undefined });

    expect(result.current.saveDraft).toBe(first);
  });
});
