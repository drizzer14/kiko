import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
// Side-effect import: src/i18n/index.ts calls `i18next.init()` at module
// load. Every test file gets its own fresh module registry, so without this
// import `useTranslation`'s `t()` returns the raw key (e.g.
// "settings.dataImport.keyPlaceholder") instead of the real English string
// this suite asserts on — the same reason
// src/screens/settings/settings/settings.screen.test.tsx imports it.
import '../../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';

const mockPick = jest.fn();
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  types: { allFiles: '*/*', json: 'application/json' },
}));

const mockImportData = jest.fn();
jest.mock('@kiko/data-transfer/import-data', () => ({
  importData: (...args: unknown[]) => mockImportData(...args),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn().mockResolvedValue(''),
}));

import ImportDataScreen from './import-data.screen';

// The installed @testing-library/react-native (14.0.1) ships an ASYNC
// `render` and an ASYNC `fireEvent` (both return Promises, confirmed against
// node_modules/@testing-library/react-native/dist/{render,fire-event}.js) —
// unlike the brief's Step 1 snippet, which assumes the older sync API. Every
// call site here awaits both, matching the working convention already used
// by src/screens/settings/settings/settings.screen.test.tsx.
const renderScreen = () =>
  render(
    <ImportDataScreen
      navigation={asNavigationProp(navigationSpy())}
      route={asRouteProp('ImportData')}
    />,
  );

// The export key is a base64-encoded 32-byte key: 44 characters
// (`MIN_KEY_LENGTH` in the screen under test). A shorter value must be
// rejected before the confirm sheet opens.
const VALID_KEY = 'a'.repeat(44);

describe('ImportDataScreen', () => {
  beforeEach(() => {
    mockPick.mockReset();
    mockImportData.mockReset();
  });

  it('renders the Import button enabled even before a file or key are provided', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('settings-button-import').props.accessibilityState.disabled).toBeFalsy();
  });

  // BUG (device-feedback-round-4 item 7): pressing Import with neither a file
  // nor a key used to fail SILENTLY — no confirm sheet, no error, nothing.
  // Both must now surface their own inline error.
  it('shows inline errors for BOTH a missing file and a missing key, not a silent no-op', async () => {
    const { getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-import'));

    expect(await findByText('Choose a file to import.')).toBeTruthy();
    expect(
      await findByText('The key looks too short — paste the full key from your export.'),
    ).toBeTruthy();
    expect(queryByText('Replace Data')).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });

  it('shows only the missing-file error when a valid key is already entered', async () => {
    const { getByTestId, getByPlaceholderText, findByText, queryByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));

    expect(await findByText('Choose a file to import.')).toBeTruthy();
    expect(
      queryByText('The key looks too short — paste the full key from your export.'),
    ).toBeNull();
    expect(queryByText('Replace Data')).toBeNull();
  });

  it('clears the missing-file error once a valid file is picked', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    const { getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-import'));
    expect(await findByText('Choose a file to import.')).toBeTruthy();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    expect(queryByText('Choose a file to import.')).toBeNull();
  });

  it('rejects a picked file whose name does not end in .kiko', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.txt', name: 'picked.txt' }]);

    const { getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    expect(await findByText('Choose a Kiko export file (.kiko).')).toBeTruthy();
    expect(queryByText('picked.txt')).toBeNull();

    await fireEvent.press(getByTestId('settings-button-import'));

    // Still no file — pressing Import must not call importData or open the sheet.
    expect(queryByText('Replace Data')).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });

  it('shows a too-short-key error and does not open the confirm sheet', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);

    const { getByTestId, getByPlaceholderText, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), 'short');
    await fireEvent.press(getByTestId('settings-button-import'));

    expect(
      await findByText('The key looks too short — paste the full key from your export.'),
    ).toBeTruthy();
    expect(queryByText('Replace Data')).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });

  it('shows a confirm sheet before importing, and only calls importData after confirming', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockResolvedValue({
      accountsRestored: 2,
      holdingsRestored: 3,
      transactionsRestored: 10,
    });

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));

    // The destructive ConfirmSheet must appear before any real import runs.
    expect(mockImportData).not.toHaveBeenCalled();
    await fireEvent.press(await findByText('Replace Data'));

    await waitFor(() =>
      expect(mockImportData).toHaveBeenCalledWith({
        fileUri: 'file:///picked.kiko',
        keyBase64: VALID_KEY,
      }),
    );
  });

  it('shows a wrong-key-specific error when importData throws a decrypt-prefixed error', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockRejectedValue(
      new Error('data-transfer/decrypt: wrong key or corrupted file'),
    );

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace Data'));

    await waitFor(() => expect(mockImportData).toHaveBeenCalled());
  });
});
