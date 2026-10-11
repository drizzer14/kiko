import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import TemplateSelect from './template-select.component';
import type { TemplateSelectProps } from './template-select.props';

const TEMPLATES = [
  { id: 't1', name: 'Rent' },
  { id: 't2', name: 'Coffee' },
];

const setup = async (overrides: Partial<TemplateSelectProps> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <TemplateSelect templates={TEMPLATES} selectedId={null} onSelect={onSelect} {...overrides} />,
  );

  return { onSelect, ...utils };
};

describe('TemplateSelect', () => {
  it('shows the placeholder while nothing is picked', async () => {
    const { getByTestId } = await setup();

    expect(getByTestId('template-field')).toHaveTextContent('Select a template');
  });

  it("shows the picked template's name", async () => {
    const { getByTestId } = await setup({ selectedId: 't2' });

    expect(getByTestId('template-field')).toHaveTextContent('Coffee');
  });

  it('lists every template by name in a sheet titled Template, and reports a pick', async () => {
    const { onSelect, getByLabelText, getByTestId, getByText, queryByTestId } = await setup();

    expect(queryByTestId('template-field-option-t1')).toBeNull();

    await fireEvent.press(getByLabelText('Template'));

    expect(getByText('Rent')).toBeTruthy();
    expect(getByText('Coffee')).toBeTruthy();

    await fireEvent.press(getByTestId('template-field-option-t1'));

    expect(onSelect).toHaveBeenCalledWith('t1');
    expect(queryByTestId('template-field-option-t1')).toBeNull();
  });

  it('shows no hint while there are templates', async () => {
    const { queryByText } = await setup();

    expect(queryByText(/No templates yet/)).toBeNull();
  });

  it('shows the hint under the select when there are no templates', async () => {
    const { getByTestId, getByText } = await setup({ templates: [] });

    expect(getByTestId('template-field')).toHaveTextContent('Select a template');
    expect(
      getByText('No templates yet. Turn on "Save as a new template" when you save a transaction.'),
    ).toBeTruthy();
  });
});
