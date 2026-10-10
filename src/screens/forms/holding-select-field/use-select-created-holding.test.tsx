import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';

import { useSelectCreatedHolding } from './use-select-created-holding';
import type { HoldingSelectOption } from './holding-select-field.props';

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
      useSelectCreatedHolding(options, onSelect),
    { wrapper, initialProps: { options: initialOptions } },
  );

  return { onSelect, fireFocus, ...hook };
};

describe('useSelectCreatedHolding', () => {
  let clock = TAPPED_AT;

  beforeEach(() => {
    clock = TAPPED_AT;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects the holding that appears after the create row was pressed', async () => {
    const { onSelect, result, rerender } = await setup();

    await act(async () => {
      result.current();
    });
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('does not select a holding that appears without a press', async () => {
    const { onSelect, rerender } = await setup();

    await rerender({ options: [makeOption('synced', SAVED_AT)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects only once, however often the options change afterwards', async () => {
    const { onSelect, result, rerender } = await setup();

    await act(async () => {
      result.current();
    });
    await rerender({ options: [makeOption('new', SAVED_AT)] });
    await rerender({ options: [makeOption('new', SAVED_AT), makeOption('other', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects a holding saved before the screen regained focus, even when it lands after', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();

    await act(async () => {
      result.current();
    });

    clock = RETURNED_AT;
    await act(async () => {
      fireFocus();
    });
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('selects nothing when a holding appears after HoldingForm was cancelled', async () => {
    const { onSelect, result, rerender, fireFocus } = await setup();

    await act(async () => {
      result.current();
    });

    clock = RETURNED_AT;
    await act(async () => {
      fireFocus();
    });

    // A bank sync adds an eligible holding well after the user came back.
    await rerender({ options: [makeOption('synced', RETURNED_AT + 60 * SECOND)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects nothing for a holding created before the create row was pressed', async () => {
    const { onSelect, result, rerender } = await setup();

    await act(async () => {
      result.current();
    });
    await rerender({ options: [makeOption('older', TAPPED_AT - 60 * SECOND)] });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepts a holding created in the same second as the press', async () => {
    const { onSelect, result, rerender } = await setup();

    clock = TAPPED_AT + 400;
    await act(async () => {
      result.current();
    });
    // The database stamps `created_at` in whole seconds, rounded down.
    await rerender({ options: [makeOption('new', TAPPED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });

  it('works outside a navigator, where no focus event ever arrives', async () => {
    const onSelect = jest.fn();
    const { result, rerender } = await renderHook(
      ({ options }: { options: readonly HoldingSelectOption[] }) =>
        useSelectCreatedHolding(options, onSelect),
      { initialProps: { options: [] as readonly HoldingSelectOption[] } },
    );

    await act(async () => {
      result.current();
    });
    await rerender({ options: [makeOption('new', SAVED_AT)] });

    expect(onSelect).toHaveBeenCalledWith('new');
  });
});
