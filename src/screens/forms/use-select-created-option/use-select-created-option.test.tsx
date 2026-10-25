import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import { useSelectCreatedOption } from './use-select-created-option';

const SECOND = 1_000;
const TAPPED_AT = 100 * SECOND;
const SAVED_AT = 130 * SECOND;
const RETURNED_AT = 131 * SECOND;

const makeOption = (id: string, createdAt: number): HoldingSelectOption => ({
  id,
  name: `Holding ${id}`,
  icon: 'creditcard',
  color: '#3366FF',
  currency: 'USD',
  accountName: 'Personal',
  createdAt,
});

const setup = async (initialOptions: readonly HoldingSelectOption[] = []) => {
  const onSelect = jest.fn();
  const { provide, fireFocus } = makeFocusNavigation();
  const wrapper = ({ children }: { children: ReactNode }) => provide(children);
  const hook = await renderHook(
    ({ options }: { options: readonly HoldingSelectOption[] }) =>
      useSelectCreatedOption(options, onSelect),
    { wrapper, initialProps: { options: initialOptions } },
  );

  return { onSelect, fireFocus, ...hook };
};

const pressCreateRow = async (result: { current: () => void }): Promise<void> => {
  await act(async () => {
    result.current();
  });
};

describe('useSelectCreatedOption', () => {
  let clock = TAPPED_AT;

  const returnToScreen = async (fireFocus: () => void): Promise<void> => {
    clock = RETURNED_AT;
    await act(async () => {
      fireFocus();
    });
  };

  beforeEach(() => {
    clock = TAPPED_AT;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects the option that appears after the create row was pressed', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('does not select an option that appears without a press', async () => {
    const { onSelect, rerender } = await setup();

    await rerender({ options: [makeOption('synced', SAVED_AT)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects only once, however often the options change afterwards', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await rerender({ options: [makeOption('new', SAVED_AT)] });
    await rerender({ options: [makeOption('new', SAVED_AT), makeOption('other', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects an option saved before the screen regained focus, even when it lands after', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();

    await pressCreateRow(result);
    await returnToScreen(fireFocus);
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects nothing when an option appears after the create form was cancelled', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();

    await pressCreateRow(result);
    await returnToScreen(fireFocus);

    // A bank sync adds an eligible holding well after the user came back.
    await rerender({ options: [makeOption('synced', RETURNED_AT + 60 * SECOND)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects nothing for an option created before the create row was pressed', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await rerender({ options: [makeOption('older', TAPPED_AT - 60 * SECOND)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepts an option created in the same second as the press', async () => {
    const { onSelect, result, rerender } = await setup();

    clock = TAPPED_AT + 400;
    await pressCreateRow(result);
    // The database stamps `created_at` in whole seconds, rounded down.
    await rerender({ options: [makeOption('new', TAPPED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects the newest option created in the window when another option was created elsewhere first', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    // "Coffee" is created on another tab while the pushed form is open; "Rent" is saved later.
    await rerender({
      options: [makeOption('coffee', SAVED_AT - 20 * SECOND), makeOption('rent', SAVED_AT)],
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('rent');
  });

  it('selects the last in list order when two options carry the same whole-second stamp', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await rerender({ options: [makeOption('first', SAVED_AT), makeOption('last', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('last');
  });

  it('selects the newest by createdAt even when it is listed before an older option', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await rerender({
      options: [makeOption('newer', SAVED_AT), makeOption('older', SAVED_AT - 20 * SECOND)],
    });

    expect(onSelect).toHaveBeenCalledWith('newer');
  });

  it('selects once for two presses before one close', async () => {
    const { onSelect, result, rerender } = await setup();

    await pressCreateRow(result);
    await pressCreateRow(result);
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('works outside a navigator, where no focus event ever arrives', async () => {
    const onSelect = jest.fn();
    const { result, rerender } = await renderHook(
      ({ options }: { options: readonly HoldingSelectOption[] }) =>
        useSelectCreatedOption(options, onSelect),
      { initialProps: { options: [] as readonly HoldingSelectOption[] } },
    );

    await pressCreateRow(result);
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects a created template-shaped option, which carries only an id, a name and a createdAt', async () => {
    type TemplateShapedOption = { id: string; name: string; createdAt: number };

    const onSelect = jest.fn();
    const { result, rerender } = await renderHook(
      ({ options }: { options: readonly TemplateShapedOption[] }) =>
        useSelectCreatedOption(options, onSelect),
      { initialProps: { options: [] as readonly TemplateShapedOption[] } },
    );

    await pressCreateRow(result);
    await rerender({ options: [{ id: 'template-new', name: 'Rent', createdAt: SAVED_AT }] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('template-new');
  });
});
