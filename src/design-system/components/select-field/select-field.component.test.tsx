import { act, fireEvent, render } from '@testing-library/react-native';
import { spyOnModalAnimationPerTest } from '@kiko/test-support/modal-animation-spy';

import '@kiko/design-system/unistyles';
import SelectField from '.';
import type { SelectFieldProps } from './select-field.props';

type Kind = 'a' | 'b' | 'c';

const options: readonly Kind[] = ['a', 'b', 'c'];
const labels: Record<Kind, string> = { a: 'Alpha', b: 'Beta', c: 'Gamma' };
const subtitles: Record<Kind, string> = { a: 'First', b: 'Second', c: 'Third' };

const setup = async (overrides: Partial<SelectFieldProps<Kind>> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <SelectField<Kind>
      label="Kind"
      sheetTitle="Select a Kind"
      options={options}
      selected="a"
      onSelect={onSelect}
      labels={labels}
      subtitles={subtitles}
      placeholder="Select a kind"
      testID="kind-field"
      {...overrides}
    />,
  );

  return { onSelect, ...utils };
};

// The Modal's own `onDismiss`, which fires once the close animation has
// finished. The Modal has left the tree by then, so the host read while the
// sheet was open is called directly.
const finishClosing = async (sheet: { props: Record<string, unknown> }): Promise<void> => {
  await act(async () => (sheet.props.onDismiss as () => void)());
};

describe('SelectField', () => {
  const modal = spyOnModalAnimationPerTest('kind-field-sheet-modal');

  it("shows the selected option's label in the trigger", async () => {
    const { getByTestId } = await setup();

    expect(getByTestId('kind-field')).toHaveTextContent('Alpha');
  });

  it('shows the placeholder when nothing is selected yet', async () => {
    const { getByTestId } = await setup({ selected: null });

    expect(getByTestId('kind-field')).toHaveTextContent('Select a kind');
  });

  it('lists every option with its subtitle on trigger press, and reports a pick', async () => {
    const { onSelect, getByTestId, queryByTestId } = await setup();

    expect(queryByTestId('kind-field-option-b')).toBeNull();

    await fireEvent.press(getByTestId('kind-field'));

    for (const option of options) {
      expect(getByTestId(`kind-field-option-${option}`)).toBeTruthy();
      expect(getByTestId(`kind-field-option-${option}-description`)).toHaveTextContent(
        subtitles[option],
      );
    }

    await fireEvent.press(getByTestId('kind-field-option-b'));

    expect(onSelect).toHaveBeenCalledWith('b');
    expect(queryByTestId('kind-field-option-b')).toBeNull();
  });

  describe('onSelectClosed', () => {
    it('does not run on the pick itself, while the sheet is still closing', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-b'));

      expect(onSelectClosed).not.toHaveBeenCalled();
    });

    it('runs with the pick once the sheet reports it has finished closing', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      // The sheet's Modal leaves the tree once closed, so its host is read while open.
      const sheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await finishClosing(sheet);

      expect(onSelectClosed).toHaveBeenCalledTimes(1);
      expect(onSelectClosed).toHaveBeenCalledWith('b');
    });

    it('runs once per pick, however often the sheet reports closed', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      const sheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await finishClosing(sheet);
      await finishClosing(sheet);

      expect(onSelectClosed).toHaveBeenCalledTimes(1);
    });

    it('does not run when the sheet closes without a pick', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent(getByTestId('kind-field-sheet-modal'), 'dismiss');

      expect(onSelectClosed).not.toHaveBeenCalled();
    });

    it('runs again for a later pick', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      const firstSheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await finishClosing(firstSheet);
      await fireEvent.press(getByTestId('kind-field'));
      const secondSheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-c'));
      await finishClosing(secondSheet);

      expect(onSelectClosed).toHaveBeenNthCalledWith(2, 'c');
    });

    it('is optional: a close without it changes nothing', async () => {
      const { onSelect, getByTestId, queryByTestId } = await setup();

      await fireEvent.press(getByTestId('kind-field'));
      const sheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await finishClosing(sheet);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(queryByTestId('kind-field-option-b')).toBeNull();
      expect(getByTestId('kind-field')).toHaveTextContent('Alpha');
    });
  });

  describe('closesWithoutAnimation', () => {
    const onlyB = (option: Kind): boolean => option === 'b';

    it('closes with no animation for a pick it names', async () => {
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-b'));

      expect(modal.lastHiddenAnimation()).toBe('none');
    });

    it('keeps the fade for a pick it does not name', async () => {
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-c'));

      expect(modal.lastHiddenAnimation()).toBe('fade');
    });

    it('keeps the fade for every pick when it is omitted', async () => {
      const { getByTestId } = await setup();

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-b'));

      expect(modal.lastHiddenAnimation()).toBe('fade');
    });

    it('keeps the fade when the sheet is closed without a pick', async () => {
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent(getByTestId('kind-field-sheet-modal'), 'requestClose');

      expect(modal.lastHiddenAnimation()).toBe('fade');
    });

    it('still reports the pick only once the sheet has finished closing', async () => {
      const onSelectClosed = jest.fn();
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB, onSelectClosed });

      await fireEvent.press(getByTestId('kind-field'));
      const sheet = getByTestId('kind-field-sheet-modal');
      await fireEvent.press(getByTestId('kind-field-option-b'));

      expect(onSelectClosed).not.toHaveBeenCalled();

      await finishClosing(sheet);

      expect(onSelectClosed).toHaveBeenCalledWith('b');
    });

    it('fades the sheet in again when it reopens after a pick that closed it with no animation', async () => {
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await fireEvent.press(getByTestId('kind-field'));

      expect(modal.lastShownAnimation()).toBe('fade');
    });

    it('fades the second close after a no-animation one when the next pick is not named', async () => {
      const { getByTestId } = await setup({ closesWithoutAnimation: onlyB });

      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-b'));
      await fireEvent.press(getByTestId('kind-field'));
      await fireEvent.press(getByTestId('kind-field-option-c'));

      expect(modal.lastHiddenAnimation()).toBe('fade');
    });
  });

  describe('emptyAction', () => {
    const ACTION_LABEL = 'Add kind';

    const openEmptySheet = async (overrides: Partial<SelectFieldProps<Kind>> = {}) => {
      const onPress = jest.fn();
      const onSelectClosed = jest.fn();
      const utils = await setup({
        options: [],
        selected: null,
        emptyAction: { label: ACTION_LABEL, onPress },
        onSelectClosed,
        ...overrides,
      });

      await fireEvent.press(utils.getByTestId('kind-field'));

      return { onPress, onSelectClosed, ...utils };
    };

    it('shows the action row with a plus glyph when there are no options', async () => {
      const { getByTestId } = await openEmptySheet();

      const row = getByTestId('kind-field-empty-action');
      const glyphs = row.queryAll((node) => node.props.name === 'plus');

      expect(row).toHaveTextContent(ACTION_LABEL);
      expect(glyphs.length).toBeGreaterThan(0);
    });

    it('shows no action row when there are options', async () => {
      const { getByTestId, queryByTestId, queryByText } = await openEmptySheet({
        options,
        selected: 'a',
      });

      expect(getByTestId('kind-field-option-a')).toBeTruthy();
      expect(queryByTestId('kind-field-empty-action')).toBeNull();
      expect(queryByText(ACTION_LABEL)).toBeNull();
    });

    it('shows no action row when emptyAction is omitted', async () => {
      const { queryByTestId, queryByText } = await openEmptySheet({ emptyAction: undefined });

      expect(queryByTestId('kind-field-empty-action')).toBeNull();
      expect(queryByText(ACTION_LABEL)).toBeNull();
    });

    it('does not run the action on the press itself, while the sheet is still closing', async () => {
      const { onPress, getByTestId } = await openEmptySheet();

      await fireEvent.press(getByTestId('kind-field-empty-action'));

      expect(onPress).not.toHaveBeenCalled();
    });

    it('runs the action once the sheet reports it has finished closing', async () => {
      const { onPress, getByTestId } = await openEmptySheet();
      const sheet = getByTestId('kind-field-sheet-modal');

      await fireEvent.press(getByTestId('kind-field-empty-action'));
      await finishClosing(sheet);

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('runs the action once per press, however often the sheet reports closed', async () => {
      const { onPress, getByTestId } = await openEmptySheet();
      const sheet = getByTestId('kind-field-sheet-modal');

      await fireEvent.press(getByTestId('kind-field-empty-action'));
      await finishClosing(sheet);
      await finishClosing(sheet);

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('closes the sheet with no animation for the action', async () => {
      const { getByTestId } = await openEmptySheet();

      await fireEvent.press(getByTestId('kind-field-empty-action'));

      expect(modal.lastHiddenAnimation()).toBe('none');
    });

    it('never reports the action as a pick to onSelect or onSelectClosed', async () => {
      const { onSelect, onSelectClosed, onPress, getByTestId } = await openEmptySheet();
      const sheet = getByTestId('kind-field-sheet-modal');

      await fireEvent.press(getByTestId('kind-field-empty-action'));
      await finishClosing(sheet);

      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onSelectClosed).not.toHaveBeenCalled();
    });

    it('never writes an "undefined-empty-action" testID when testID is omitted', async () => {
      const { getByText, queryByTestId } = await render(
        <SelectField<Kind>
          label="Kind"
          sheetTitle="Select a Kind"
          options={[]}
          selected={null}
          onSelect={jest.fn()}
          labels={labels}
          placeholder="Select a kind"
          emptyAction={{ label: ACTION_LABEL, onPress: jest.fn() }}
        />,
      );

      await fireEvent.press(getByText('Select a kind'));

      expect(getByText(ACTION_LABEL)).toBeTruthy();
      expect(queryByTestId('undefined-empty-action')).toBeNull();
    });
  });

  it('renders the field error under the trigger, matching FieldTrigger', async () => {
    const { getByTestId } = await setup({ selected: null, error: 'Pick a kind.' });

    expect(getByTestId('kind-field-error')).toHaveTextContent('Pick a kind.');
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByTestId, getByText } = await setup();

    await fireEvent.press(getByTestId('kind-field'));

    expect(getByText('Select a Kind')).toBeTruthy();
  });

  it('never writes an "undefined-option-x" testID when testID is omitted', async () => {
    const onSelect = jest.fn();
    const { getByText, queryByTestId } = await render(
      <SelectField<Kind>
        label="Kind"
        sheetTitle="Select a Kind"
        options={options}
        selected="a"
        onSelect={onSelect}
        labels={labels}
        placeholder="Select a kind"
      />,
    );

    await fireEvent.press(getByText('Alpha'));
    await fireEvent.press(getByText('Beta'));

    expect(onSelect).toHaveBeenCalledWith('b');
    expect(queryByTestId(/undefined-option-/)).toBeNull();
  });
});
