import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import TokenConnectField from '.';

const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const baseProps = {
  notice: 'Create the token in the bank app.',
  label: 'Token',
  value: '',
  onChangeText: jest.fn(),
  placeholder: 'Paste your token',
  pasteAccessibilityLabel: 'Paste from clipboard',
  connectLabel: 'Connect',
  onConnectPress: jest.fn(),
  connectDisabled: false,
  status: { kind: 'idle' } as const,
};

describe('TokenConnectField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the notice, the labeled token field, and the Connect action', async () => {
    const view = await render(<TokenConnectField {...baseProps} />);

    expect(view.getByText(baseProps.notice)).toBeTruthy();
    expect(view.getByPlaceholderText(baseProps.placeholder)).toBeTruthy();
    expect(view.getByRole('button', { name: baseProps.connectLabel })).toBeTruthy();
  });

  it('pastes into the token field, trimmed', async () => {
    mockGetString.mockResolvedValue('  pasted-token  ');
    const onChangeText = jest.fn();
    const view = await render(<TokenConnectField {...baseProps} onChangeText={onChangeText} />);

    await act(async () => {
      await fireEvent.press(view.getByLabelText(baseProps.pasteAccessibilityLabel));
    });

    expect(onChangeText).toHaveBeenCalledWith('pasted-token');
  });

  it('renders the token field as secure', async () => {
    const view = await render(<TokenConnectField {...baseProps} />);

    expect(view.getByPlaceholderText(baseProps.placeholder).props.secureTextEntry).toBe(true);
  });

  it('calls onConnectPress when Connect is pressed', async () => {
    const onConnectPress = jest.fn();
    const view = await render(<TokenConnectField {...baseProps} onConnectPress={onConnectPress} />);

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: baseProps.connectLabel }));
    });

    expect(onConnectPress).toHaveBeenCalledTimes(1);
  });

  it('disables Connect when connectDisabled is true', async () => {
    const view = await render(<TokenConnectField {...baseProps} connectDisabled />);

    expect(view.getByRole('button', { name: baseProps.connectLabel })).toBeDisabled();
  });

  it('shows the sync status message', async () => {
    const view = await render(
      <TokenConnectField {...baseProps} status={{ kind: 'success', message: 'Connected!' }} />,
    );

    expect(view.getByText('Connected!')).toBeTruthy();
  });
});
