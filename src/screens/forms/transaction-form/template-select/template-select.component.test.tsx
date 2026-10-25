import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import TemplateSelect from './template-select.component';
import type { TemplateSelectProps } from './template-select.props';

const SECOND = 1_000;
const PRESSED_AT = 100 * SECOND;
const SAVED_AT = 130 * SECOND;

const TEMPLATES = [
  { id: 't1', name: 'Rent', createdAt: 10 * SECOND },
  { id: 't2', name: 'Coffee', createdAt: 20 * SECOND },
];

const setup = async (overrides: Partial<TemplateSelectProps> = {}) => {
  const onSelect = jest.fn();
  const onCreateTemplate = jest.fn();
  const props: TemplateSelectProps = {
    templates: TEMPLATES,
    isLoading: false,
    selectedId: null,
    onSelect,
    onCreateTemplate,
    ...overrides,
  };

  const utils = await render(<TemplateSelect {...props} />);

  return { onSelect, onCreateTemplate, props, ...utils };
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
  let clock = PRESSED_AT;

  beforeEach(() => {
    clock = PRESSED_AT;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('reports the template created after the row was pressed through onSelect', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    await utils.rerender(
      <TemplateSelect
        {...utils.props}
        templates={[{ id: 'created', name: 'Gym', createdAt: SAVED_AT }]}
      />,
    );

    expect(utils.onSelect).toHaveBeenCalledTimes(1);
    expect(utils.onSelect).toHaveBeenCalledWith('created');
  });

  it('reports the newest template when two appear in the window, the older one created elsewhere', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    await utils.rerender(
      <TemplateSelect
        {...utils.props}
        templates={[
          { id: 'coffee', name: 'Coffee', createdAt: SAVED_AT - 20 * SECOND },
          { id: 'rent', name: 'Rent', createdAt: SAVED_AT },
        ]}
      />,
    );

    expect(utils.onSelect).toHaveBeenCalledTimes(1);
    expect(utils.onSelect).toHaveBeenCalledWith('rent');
  });

  it('reports nothing when no template appears after the row was pressed', async () => {
    const utils = await setup({ templates: [] });

    await pressAddTemplate(utils);
    await utils.rerender(<TemplateSelect {...utils.props} templates={[]} />);

    expect(utils.onCreateTemplate).toHaveBeenCalledTimes(1);
    expect(utils.onSelect).not.toHaveBeenCalled();
  });

  it('reports no template that appears without a press', async () => {
    const utils = await setup({ templates: [] });

    await utils.rerender(
      <TemplateSelect
        {...utils.props}
        templates={[{ id: 'synced', name: 'Gym', createdAt: SAVED_AT }]}
      />,
    );

    expect(utils.onSelect).not.toHaveBeenCalled();
  });
});
