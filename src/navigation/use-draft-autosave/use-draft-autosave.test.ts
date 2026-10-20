import { useState } from 'react';
import type { LayoutMode } from '@kiko/display-regions';
import { act, renderHook } from '@testing-library/react-native';

import { useDraftAutosave } from '.';

const mockLayout: { mode: LayoutMode } = { mode: 'single' };

jest.mock('@kiko/display-regions', () => ({
  useLayoutMode: () => mockLayout.mode,
  useIsLargeWindow: () => false,
}));

type Draft = { text: string };

// A form in miniature: one typed field, a draft built from it, and the blur handler.
const renderForm = async (saveDraft: jest.Mock, restored?: Draft) => {
  const hook = await renderHook(() => {
    const [text, setText] = useState('a');
    const onFieldBlur = useDraftAutosave<Draft>({ text }, saveDraft, restored);

    return { setText, onFieldBlur };
  });

  return hook;
};

describe('useDraftAutosave', () => {
  beforeEach(() => {
    mockLayout.mode = 'single';
  });

  it('saves nothing on mount', async () => {
    const saveDraft = jest.fn();

    await renderForm(saveDraft);

    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves nothing while the user types, only when a field blurs', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    await act(async () => result.current.setText('abc'));

    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves the draft once per blur', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    await act(async () => result.current.onFieldBlur());

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith({ text: 'ab' });
  });

  it('saves the draft as the blur left it, with the state changes the blur itself made', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => {
      result.current.setText('picked by the blur');
      result.current.onFieldBlur();
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith({ text: 'picked by the blur' });
  });

  it('saves nothing for a blur on a form the user has not changed', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.onFieldBlur());
    await act(async () => result.current.onFieldBlur());

    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves again on the next blur once the user changed something', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    await act(async () => result.current.onFieldBlur());
    await act(async () => result.current.setText('abc'));
    await act(async () => result.current.onFieldBlur());

    expect(saveDraft.mock.calls).toEqual([[{ text: 'ab' }], [{ text: 'abc' }]]);
  });

  it('saves a field changed back to what it first was, as the saved draft still holds the change', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    await act(async () => result.current.onFieldBlur());
    await act(async () => result.current.setText('a'));
    await act(async () => result.current.onFieldBlur());

    expect(saveDraft.mock.calls).toEqual([[{ text: 'ab' }], [{ text: 'a' }]]);
  });

  describe('a form that was restored from the draft the route holds', () => {
    // The form opened blank and a moment later took the draft's values.
    const restored: Draft = { text: 'ab' };

    it('saves nothing for a blur once the draft is back as it was', async () => {
      const saveDraft = jest.fn();
      const { result } = await renderForm(saveDraft, restored);

      await act(async () => result.current.setText('ab'));
      await act(async () => result.current.onFieldBlur());

      expect(saveDraft).not.toHaveBeenCalled();
    });

    it('saves a change back to what the form first opened as, as the route holds the restored draft', async () => {
      const saveDraft = jest.fn();
      const { result } = await renderForm(saveDraft, restored);

      await act(async () => result.current.setText('ab'));
      await act(async () => result.current.setText('a'));
      await act(async () => result.current.onFieldBlur());

      expect(saveDraft).toHaveBeenCalledTimes(1);
      expect(saveDraft).toHaveBeenCalledWith({ text: 'a' });
    });
  });

  it('saves a change once, however many blurs follow it', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    await act(async () => result.current.onFieldBlur());
    await act(async () => result.current.onFieldBlur());

    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps one handler across renders, so the fields it is handed to do not re-render', async () => {
    const saveDraft = jest.fn();
    const { result } = await renderForm(saveDraft);
    const first = result.current.onFieldBlur;

    await act(async () => result.current.setText('ab'));

    expect(result.current.onFieldBlur).toBe(first);
  });

  it('saves the draft as typed when the window changes between one pane and two', async () => {
    const saveDraft = jest.fn();
    const { result, rerender } = await renderForm(saveDraft);

    await act(async () => result.current.setText('half typed'));
    mockLayout.mode = 'columns';
    await rerender({});

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith({ text: 'half typed' });
  });

  it('saves again when the window goes back to one pane', async () => {
    const saveDraft = jest.fn();
    const { result, rerender } = await renderForm(saveDraft);

    await act(async () => result.current.setText('ab'));
    mockLayout.mode = 'columns';
    await rerender({});
    await act(async () => result.current.setText('abc'));
    mockLayout.mode = 'single';
    await rerender({});

    expect(saveDraft.mock.calls).toEqual([[{ text: 'ab' }], [{ text: 'abc' }]]);
  });

  it('saves nothing when the window changes over a form the user has not changed', async () => {
    const saveDraft = jest.fn();
    const { rerender } = await renderForm(saveDraft);

    mockLayout.mode = 'columns';
    await rerender({});

    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('saves nothing for a rerender that leaves the layout mode as it was', async () => {
    const saveDraft = jest.fn();
    const { rerender } = await renderForm(saveDraft);

    await rerender({});
    await rerender({});

    expect(saveDraft).not.toHaveBeenCalled();
  });
});
