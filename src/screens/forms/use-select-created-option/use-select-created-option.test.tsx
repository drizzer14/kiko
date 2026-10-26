import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';

import { useSelectCreatedOption } from './use-select-created-option';
import { closeHandback, handBackCreatedOption } from './created-option-handback';

type NamedOption = { id: string; name: string };

type StartRoundTrip = { current: () => string | undefined };

const makeOption = (id: string): NamedOption => ({ id, name: `Option ${id}` });

const setup = async (initialOptions: readonly NamedOption[] = []) => {
  const onSelect = jest.fn();
  const { provide, fireFocus, fireBlur } = makeFocusNavigation();
  const wrapper = ({ children }: { children: ReactNode }) => provide(children);
  const hook = await renderHook(
    ({ options }: { options: readonly NamedOption[] }) => useSelectCreatedOption(options, onSelect),
    { wrapper, initialProps: { options: initialOptions } },
  );

  return { onSelect, fireFocus, fireBlur, ...hook };
};

// The id the push would carry to the create form; undefined when the press must push nothing.
const pressCreateRow = async (result: StartRoundTrip): Promise<string | undefined> => {
  let handbackId: string | undefined;

  await act(async () => {
    handbackId = result.current();
  });

  return handbackId;
};

const pressedHandbackId = async (result: StartRoundTrip): Promise<string> => {
  const handbackId = await pressCreateRow(result);

  if (handbackId === undefined) {
    throw new Error('The press opened no handback');
  }

  return handbackId;
};

const returnToScreen = async (fireFocus: () => void): Promise<void> => {
  await act(async () => {
    fireFocus();
  });
};

describe('useSelectCreatedOption', () => {
  it('selects the handed-back option once the screen regains focus', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'new');
    await rerender({ options: [makeOption('new')] });

    expect(onSelect).not.toHaveBeenCalled();

    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('does not select an option that appears without a press', async () => {
    const { onSelect, rerender, fireFocus } = await setup();

    await rerender({ options: [makeOption('synced')] });
    await returnToScreen(fireFocus);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects only once, however often the options change afterwards', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'new');
    await rerender({ options: [makeOption('new')] });
    await returnToScreen(fireFocus);
    await rerender({ options: [makeOption('new'), makeOption('other')] });
    await rerender({ options: [makeOption('other'), makeOption('new')] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects the handed-back option when it reaches the options after the focus', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'new');
    await returnToScreen(fireFocus);

    expect(onSelect).not.toHaveBeenCalled();

    await rerender({ options: [makeOption('new')] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects the handed-back option already listed when the focus arrives', async () => {
    const { onSelect, result, fireFocus } = await setup([makeOption('new')]);
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'new');
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects nothing on a cancel, even when another option appeared during the round trip', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();

    await pressedHandbackId(result);
    await rerender({ options: [makeOption('synced')] });
    await returnToScreen(fireFocus);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects only the handed-back id, never another option listed with it', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'middle');
    await rerender({ options: [makeOption('first'), makeOption('middle'), makeOption('last')] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('middle');
  });

  it('selects Rent, handed back, and never Coffee, which another tab created during the round trip', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    await rerender({ options: [makeOption('coffee')] });
    handBackCreatedOption(handbackId, 'rent');
    await rerender({ options: [makeOption('coffee'), makeOption('rent')] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('rent');
  });

  it('opens one handback for two presses, so the second press gets no id and one selection follows', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const first = await pressCreateRow(result);
    const second = await pressCreateRow(result);

    expect(first).toEqual(expect.any(String));
    expect(second).toBeUndefined();

    handBackCreatedOption(first, 'new');
    await rerender({ options: [makeOption('new')] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects nothing outside a navigator, where no focus event arrives', async () => {
    const onSelect = jest.fn();
    const { result, rerender } = await renderHook(
      ({ options }: { options: readonly NamedOption[] }) =>
        useSelectCreatedOption(options, onSelect),
      { initialProps: { options: [] as readonly NamedOption[] } },
    );
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'new');
    await rerender({ options: [makeOption('new')] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a handed-back template-shaped option, which carries only an id and a name', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'template-new');
    await rerender({ options: [{ id: 'template-new', name: 'Rent' }] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('template-new');
  });

  it('selects nothing for a handed-back id that never reaches the options, even after the screen left and came back', async () => {
    const { onSelect, result, rerender, fireFocus, fireBlur } = await setup();
    const handbackId = await pressedHandbackId(result);

    handBackCreatedOption(handbackId, 'deleted');
    await returnToScreen(fireFocus);
    await act(async () => {
      fireBlur();
    });
    await returnToScreen(fireFocus);
    await rerender({ options: [makeOption('deleted')] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes the open handback on unmount, so a later hand-back is dropped', async () => {
    const { result, unmount } = await setup();
    const handbackId = await pressedHandbackId(result);

    await unmount();
    handBackCreatedOption(handbackId, 'new');

    expect(closeHandback(handbackId)).toBeUndefined();
  });

  it('opens a new handback for a press after a cancel', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();
    const cancelled = await pressedHandbackId(result);

    await returnToScreen(fireFocus);

    const second = await pressedHandbackId(result);

    expect(second).not.toBe(cancelled);

    handBackCreatedOption(second, 'new');
    await rerender({ options: [makeOption('new')] });
    await returnToScreen(fireFocus);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });
});
