import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import EntryTabs from './entry-tabs.component';
import type { EntryTabsProps } from './entry-tabs.props';

const TEMPLATES = [{ id: 't1', name: 'Rent' }];

const setup = async (overrides: Partial<EntryTabsProps> = {}) => {
  const onSelectTab = jest.fn();
  const onSelectTemplate = jest.fn();
  const onCreateTemplate = jest.fn();

  const utils = await render(
    <EntryTabs
      visible
      tab="manual"
      onSelectTab={onSelectTab}
      awaitsPick={false}
      templates={TEMPLATES}
      templatesLoading={false}
      selectedTemplateId={null}
      onSelectTemplate={onSelectTemplate}
      onCreateTemplate={onCreateTemplate}
      {...overrides}
    >
      <Text>the form</Text>
    </EntryTabs>,
  );

  return { onSelectTab, onSelectTemplate, onCreateTemplate, ...utils };
};

describe('EntryTabs', () => {
  it('renders only its children where the entry has no tabs', async () => {
    const { getByText, queryByLabelText, queryByTestId } = await setup({
      visible: false,
      tab: 'template',
    });

    expect(getByText('the form')).toBeTruthy();
    expect(queryByLabelText('Entry mode')).toBeNull();
    expect(queryByTestId('template-field')).toBeNull();
  });

  it('shows the Manual and Template tabs with the form and no select on Manual', async () => {
    const { getByText, queryByTestId } = await setup();

    expect(getByText('Manual')).toBeTruthy();
    expect(getByText('Template')).toBeTruthy();
    expect(getByText('the form')).toBeTruthy();
    expect(queryByTestId('template-field')).toBeNull();
  });

  it('reports the tab pressed', async () => {
    const { getByText, onSelectTab } = await setup();

    await fireEvent.press(getByText('Template'));

    expect(onSelectTab).toHaveBeenCalledWith('template');
  });

  it('shows only the select on Template while a pick is awaited', async () => {
    const { getByTestId, queryByText } = await setup({ tab: 'template', awaitsPick: true });

    expect(getByTestId('template-field')).toHaveTextContent('Select a template');
    expect(queryByText('the form')).toBeNull();
  });

  it('shows the select and the form on Template once a template is picked', async () => {
    const { getByTestId, getByText, onSelectTemplate } = await setup({
      tab: 'template',
      selectedTemplateId: 't1',
    });

    expect(getByTestId('template-field')).toHaveTextContent('Rent');
    expect(getByText('the form')).toBeTruthy();

    await fireEvent.press(getByTestId('template-field'));
    await fireEvent.press(getByTestId('template-field-option-t1'));

    expect(onSelectTemplate).toHaveBeenCalledWith('t1');
  });

  it('hands onCreateTemplate to the template select', async () => {
    const { getByTestId, onCreateTemplate } = await setup({
      tab: 'template',
      templates: [],
      awaitsPick: true,
    });

    await fireEvent.press(getByTestId('template-field'));
    const sheet = getByTestId('template-field-sheet-modal');
    await fireEvent.press(getByTestId('template-field-empty-action'));
    await act(async () => (sheet.props.onDismiss as () => void)());

    expect(onCreateTemplate).toHaveBeenCalledTimes(1);
  });
});
