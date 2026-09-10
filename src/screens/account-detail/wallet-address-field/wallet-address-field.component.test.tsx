import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';
import WalletAddressField from '../wallet-address-field';

const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

/** Resolves deferred outside the executor, for controlling async timing in tests. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

describe('WalletAddressField', () => {
  const onConnect = jest.fn<Promise<boolean>, [string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    onConnect.mockResolvedValue(true);
  });

  it('renders a plain (non-secure) address input, a paste button and a Connect wallet action', async () => {
    const { getByPlaceholderText, getByLabelText, getByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('BTC address').props.secureTextEntry).toBeFalsy();
    expect(getByLabelText('Paste from clipboard')).toBeTruthy();
    expect(getByText('Connect wallet')).toBeTruthy();
  });

  it('fills the input from the clipboard, trimmed', async () => {
    mockGetString.mockResolvedValue(`  ${ADDRESS}\n`);
    const { getByLabelText, getByPlaceholderText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });

    expect(getByPlaceholderText('BTC address').props.value).toBe(ADDRESS);
  });

  it('rejects a malformed address locally and never calls onConnect', async () => {
    const { getByPlaceholderText, getByText, findByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), 'not an address');
    await act(async () => {
      await fireEvent.press(getByText('Connect wallet'));
    });

    expect(await findByText('Invalid BTC address')).toBeTruthy();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('connects a valid (trimmed) address and shows success when onConnect resolves true', async () => {
    const { getByPlaceholderText, getByText, findByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ` ${ADDRESS} `);
    await act(async () => {
      await fireEvent.press(getByText('Connect wallet'));
    });

    expect(onConnect).toHaveBeenCalledWith(ADDRESS);
    expect(await findByText('Wallet connected')).toBeTruthy();
  });

  it('shows a connect error (not "Invalid BTC address") when onConnect resolves false', async () => {
    onConnect.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ADDRESS);
    await act(async () => {
      await fireEvent.press(getByText('Connect wallet'));
    });

    expect(await findByText('Could not connect wallet')).toBeTruthy();
    expect(queryByText('Invalid BTC address')).toBeNull();
    expect(queryByText('Wallet connected')).toBeNull();
  });

  it('disables Connect until an address is entered', async () => {
    const { getByPlaceholderText, getByRole } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    // A blank address cannot be connected.
    expect(getByRole('button', { name: 'Connect wallet' })).toBeDisabled();

    // Any non-empty address enables the action (format is checked on press).
    await fireEvent.changeText(getByPlaceholderText('BTC address'), ADDRESS);
    expect(getByRole('button', { name: 'Connect wallet' })).not.toBeDisabled();
  });

  it('shows Checking… and disables the action while onConnect is in flight', async () => {
    const pending = deferred<boolean>();
    onConnect.mockReturnValue(pending.promise);
    const { getByPlaceholderText, getByText, getByRole, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    await fireEvent.changeText(getByPlaceholderText('BTC address'), ADDRESS);
    await act(async () => {
      fireEvent.press(getByText('Connect wallet'));
    });

    expect(await findByText(/Checking/)).toBeTruthy();
    // PressableButton forwards `disabled` to its Pressable, which RN exposes as
    // accessibilityState.disabled — the built-in RNTL matcher reads exactly that.
    expect(getByRole('button', { name: 'Connect wallet' })).toBeDisabled();

    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });

    expect(queryByText(/Checking/)).toBeNull();
  });

  it('clears a stale status when the address is edited afterward', async () => {
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );
    const input = getByPlaceholderText('BTC address');

    await fireEvent.changeText(input, 'bad');
    await act(async () => {
      await fireEvent.press(getByText('Connect wallet'));
    });
    expect(await findByText('Invalid BTC address')).toBeTruthy();

    await fireEvent.changeText(input, ADDRESS);
    expect(queryByText('Invalid BTC address')).toBeNull();
  });
});

describe('WalletAddressField — localization', () => {
  const onConnect = jest.fn<Promise<boolean>, [string]>();

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the placeholder, paste label, and action from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByPlaceholderText, getByLabelText, getByText, queryByText } = await render(
      <WalletAddressField onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('BTC-адреса')).toBeTruthy();
    expect(getByLabelText('Вставити з буфера обміну')).toBeTruthy();
    expect(getByText('Підключити гаманець')).toBeTruthy();
    expect(queryByText('Connect wallet')).toBeNull();
  });
});
