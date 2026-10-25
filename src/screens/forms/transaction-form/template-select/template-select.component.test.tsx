import { act, fireEvent, render } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';
import { handBackCreatedOption } from '@kiko/screens/forms/use-select-created-option';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import TemplateSelect from './template-select.component';
import type { TemplateSelectProps } from './template-select.props';

const TEMPLATES = [
  { id: 't1', name: 'Rent' },
  { id: 't2', name: 'Coffee' },
];

// The select hears the screen's focus through its navigation, so it renders inside one the test
// can fire focus on.
const setup = async (overrides: Partial<TemplateSelectProps> = {}) => {
  const onSelect = jest.fn();
  const onCreateTemplate = jest.fn();
  const { provide, fireFocus } = makeFocusNavigation();
  const props: TemplateSelectProps = {
    templates: TEMPLATES,
    isLoading: false,
    selectedId: null,
    onSelect,
    onCreateTemplate,
    ...overrides,
  };

  const utils = await render(provide(<TemplateSelect {...props} />));

  return {
    onSelect,
    onCreateTemplate,
    ...utils,
    fireFocus: () => act(async () => fireFocus()),
    rerenderWith: (changed: Partial<TemplateSelectProps>) =>
      utils.rerender(provide(<TemplateSelect {...props} {...changed} />)),
  };
};

// The sheet's Modal leaves the tree once closed, so its host is read while open and its own
// `onDismiss` (the end of the close) is called directly.
const finishClosing = async (sheet: { props: Record<string, unknown> }): Promise<void> => {
  await act(async () => (sheet.props.onDismiss as () => void)());
};

const pressAddTemplate = async (utils: Awaited<ReturnType<typeof setup>>): Promise<void> => {
  await fireEvent.press(utils.getByTestId('template-field'));
  const sheet = utils.getByTestId('template-field-sheet-modal');
  await fireEvent.press(utils.getByTestId('template-field-empty-action'));
  await finishClosing(sheet);
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

  it('shows no hint while the list is still loading', async () => {
    const { getByTestId, queryByText } = await setup({ templates: [], isLoading: true });

    expect(getByTestId('template-field')).toHaveTextContent('Select a template');
    expect(queryByText(/No templates yet/)).toBeNull();
  });

  it('shows the hint under the select when there are no templates', async () => {
    const { getByTestId, getByText } = await setup({ templates: [] });

    expect(getByTestId('template-field')).toHaveTextContent('Select a template');
    expect(
      getByText('No templates yet. Turn on "Save as a new template" when you save a transaction.'),
    ).toBeTruthy();
  });

  it('offers an Add template row in the empty sheet, and still shows the hint under the select', async () => {
    const { getByTestId, getByText } = await setup({ templates: [] });

    await fireEvent.press(getByTestId('template-field'));

    expect(getByTestId('template-field-empty-action')).toHaveTextContent('Add template');
    expect(
      getByText('No templates yet. Turn on "Save as a new template" when you save a transaction.'),
    ).toBeTruthy();
  });

  it('offers no Add template row while the list is still loading', async () => {
    const { getByTestId, queryByTestId, queryByText } = await setup({
      templates: [],
      isLoading: true,
    });

    await fireEvent.press(getByTestId('template-field'));

    expect(queryByTestId('template-field-empty-action')).toBeNull();
    expect(queryByText('Add template')).toBeNull();
  });

  it('offers no Add template row while there are templates', async () => {
    const { getByTestId, queryByTestId, queryByText } = await setup();

    await fireEvent.press(getByTestId('template-field'));

    expect(getByTestId('template-field-option-t1')).toBeTruthy();
    expect(queryByTestId('template-field-empty-action')).toBeNull();
    expect(queryByText('Add template')).toBeNull();
  });

  it('asks for the new-template form through onCreateTemplate once the sheet has closed', async () => {
    const utils = await setup({ templates: [] });

    await fireEvent.press(utils.getByTestId('template-field'));
    const sheet = utils.getByTestId('template-field-sheet-modal');
    await fireEvent.press(utils.getByTestId('template-field-empty-action'));

    expect(utils.onCreateTemplate).not.toHaveBeenCalled();

    await finishClosing(sheet);

    expect(utils.onCreateTemplate).toHaveBeenCalledTimes(1);
  });

  it('reports the template handed back for the id onCreateTemplate received, on return', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    handBackCreatedOption(utils.onCreateTemplate.mock.calls[0][0], 'created');
    await utils.rerenderWith({ templates: [{ id: 'created', name: 'Gym' }] });
    await utils.fireFocus();

    expect(utils.onCreateTemplate).toHaveBeenCalledWith(expect.any(String));
    expect(utils.onSelect).toHaveBeenCalledTimes(1);
    expect(utils.onSelect).toHaveBeenCalledWith('created');
  });

  it('reports the handed-back template, never one created elsewhere during the round trip', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    await utils.rerenderWith({ templates: [{ id: 'coffee', name: 'Coffee' }] });
    handBackCreatedOption(utils.onCreateTemplate.mock.calls[0][0], 'rent');
    await utils.rerenderWith({
      templates: [
        { id: 'coffee', name: 'Coffee' },
        { id: 'rent', name: 'Rent' },
      ],
    });
    await utils.fireFocus();

    expect(utils.onSelect.mock.calls).toEqual([['rent']]);
  });

  it('reports nothing on a cancel, even when another template appeared during the round trip', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    await utils.rerenderWith({ templates: [{ id: 'coffee', name: 'Coffee' }] });
    await utils.fireFocus();

    expect(utils.onCreateTemplate).toHaveBeenCalledTimes(1);
    expect(utils.onSelect).not.toHaveBeenCalled();
  });

  it('reports no template that appears without a press', async () => {
    const utils = await setup({ templates: [] });

    await utils.rerenderWith({ templates: [{ id: 'synced', name: 'Gym' }] });
    await utils.fireFocus();

    expect(utils.onSelect).not.toHaveBeenCalled();
  });
});
