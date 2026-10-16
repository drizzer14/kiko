import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';

import SaveAsTemplate from './save-as-template.component';
import type { SaveAsTemplateProps } from './save-as-template.props';

const baseProps: SaveAsTemplateProps = {
  visible: true,
  isOn: false,
  onToggle: jest.fn(),
  name: '',
  onChangeName: jest.fn(),
};

describe('SaveAsTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the switch off, with no name field', async () => {
    const { getByText, getByRole, queryByLabelText } = await render(
      <SaveAsTemplate {...baseProps} />,
    );

    expect(getByText('Save as a new template')).toBeTruthy();
    expect(getByRole('switch').props.value).toBe(false);
    expect(queryByLabelText('Template name')).toBeNull();
  });

  it('shows the name field, with its value and error, once the switch is on', async () => {
    const { getByRole, getByLabelText, getByText } = await render(
      <SaveAsTemplate {...baseProps} isOn name="Rent" error="Enter a template name." />,
    );

    expect(getByRole('switch').props.value).toBe(true);
    expect(getByLabelText('Template name').props.value).toBe('Rent');
    expect(getByText('Enter a template name.')).toBeTruthy();
  });

  it('reports the toggle and the typed name', async () => {
    const onToggle = jest.fn();
    const onChangeName = jest.fn();
    const { getByRole, getByLabelText } = await render(
      <SaveAsTemplate {...baseProps} isOn onToggle={onToggle} onChangeName={onChangeName} />,
    );

    await fireEvent(getByRole('switch'), 'valueChange', false);
    await fireEvent.changeText(getByLabelText('Template name'), 'Tea');

    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onChangeName).toHaveBeenCalledWith('Tea');
  });

  it('renders nothing while it is not visible, even when on', async () => {
    const { queryByText, queryByLabelText } = await render(
      <SaveAsTemplate {...baseProps} visible={false} isOn />,
    );

    expect(queryByText('Save as a new template')).toBeNull();
    expect(queryByLabelText('Template name')).toBeNull();
  });
});
