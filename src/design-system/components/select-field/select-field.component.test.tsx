import { fireEvent, render } from '@testing-library/react-native';

import '../../unistyles';
import SelectField from '.';

type Kind = 'a' | 'b' | 'c';

const options: readonly Kind[] = ['a', 'b', 'c'];
const labels: Record<Kind, string> = { a: 'Alpha', b: 'Beta', c: 'Gamma' };
const subtitles: Record<Kind, string> = { a: 'First', b: 'Second', c: 'Third' };

const setup = async (overrides: Partial<Parameters<typeof SelectField>[0]> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <SelectField<Kind>
      label="Kind"
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

describe('SelectField', () => {
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

  it('renders the field error under the trigger, matching FieldTrigger', async () => {
    const { getByTestId } = await setup({ selected: null, error: 'Pick a kind.' });

    expect(getByTestId('kind-field-error')).toHaveTextContent('Pick a kind.');
  });
});
