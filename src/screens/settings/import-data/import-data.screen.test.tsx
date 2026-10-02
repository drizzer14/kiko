import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  types: { allFiles: '*/*', json: 'application/json' },
}));

const mockImportData = jest.fn();
jest.mock('@kiko/data-transfer/import-data', () => ({
  importData: (...args: unknown[]) => mockImportData(...args),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn().mockResolvedValue(''),
}));

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

import ImportDataScreen from './import-data.screen';

// The installed @testing-library/react-native (14.0.1) ships an ASYNC
// `render` and an ASYNC `fireEvent` (both return Promises, confirmed against
// node_modules/@testing-library/react-native/dist/{render,fire-event}.js).
// Every call site here awaits both, matching the working convention already used
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
  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    mockPick.mockReset();
    mockImportData.mockReset();
    mockKeepLocalCopy.mockReset();
    // The "restored language" test below drives a REAL i18n.changeLanguage
    // call (only importData is mocked); reset it before every test so a
    // language switch never leaks into a later test's assertions — same
    // convention as settings.screen.test.tsx's localization describe block.
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    // Default: the local copy succeeds, returning a sandbox path RNFS can read.
    // Keyed off the input so each test's imported uri is predictable.
    mockKeepLocalCopy.mockImplementation(
      (options: { files: { uri: string; fileName: string }[] }) =>
        Promise.resolve([
          {
            status: 'success',
            sourceUri: options.files[0].uri,
            localUri: `file:///local/${options.files[0].fileName}`,
          },
        ]),
    );
  });

  it('renders the Import button enabled even before a file or key are provided', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('settings-button-import').props.accessibilityState.disabled).toBeFalsy();
  });

  // Pressing Import with neither a file nor a key used to fail SILENTLY — no
  // confirm sheet, no error, nothing. Both must now surface their own inline
  // error.
  it('shows inline errors for BOTH a missing file and a missing key, not a silent no-op', async () => {
    const { getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-import'));

    expect(await findByText('Choose a file to import.')).toBeTruthy();
    expect(
      await findByText('The key looks too short — paste the full key from your export.'),
    ).toBeTruthy();
    expect(queryByText('Replace data')).toBeNull();
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
    expect(queryByText('Replace data')).toBeNull();
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
    expect(queryByText('Replace data')).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });

  it('shows a too-short-key error and does not open the confirm sheet', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);

    const { getByTestId, getByPlaceholderText, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), 'short');

    expect(isLabelInvalid(mockFieldLabel, 'Encryption key')).toBe(false);

    await fireEvent.press(getByTestId('settings-button-import'));

    expect(
      await findByText('The key looks too short — paste the full key from your export.'),
    ).toBeTruthy();
    expect(isLabelInvalid(mockFieldLabel, 'Encryption key')).toBe(true);
    expect(queryByText('Replace data')).toBeNull();
    expect(mockImportData).not.toHaveBeenCalled();
  });

  it('shows a confirm sheet before importing, and only calls importData after confirming', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockResolvedValue({
      accountsRestored: 2,
      holdingsRestored: 3,
      transactionsRestored: 10,
      unrestoredCredentials: [],
    });

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));

    // The destructive ConfirmSheet must appear before any real import runs.
    expect(mockImportData).not.toHaveBeenCalled();
    await fireEvent.press(await findByText('Replace data'));

    // Imports the SANDBOX-LOCAL copy (`keepLocalCopy`'s `localUri`), never the
    // raw picked uri — reading the external URI directly is what made an
    // AirDropped .kiko fail as "invalid file".
    await waitFor(() =>
      expect(mockImportData).toHaveBeenCalledWith({
        fileUri: 'file:///local/picked.kiko',
        keyBase64: VALID_KEY,
      }),
    );
  });

  // The real device bug: a picked file (AirDrop / Files / iCloud) is a
  // security-scoped external URI RNFS cannot read directly. The screen must
  // copy it into the app sandbox first and import THAT local path.
  it('copies the picked file into the sandbox and imports the local copy', async () => {
    const externalUri = 'file:///private/var/mobile/Containers/Shared/kiko-demo-en.kiko';
    mockPick.mockResolvedValue([{ uri: externalUri, name: 'kiko-demo-en.kiko' }]);
    mockImportData.mockResolvedValue({
      accountsRestored: 1,
      holdingsRestored: 1,
      transactionsRestored: 1,
      unrestoredCredentials: [],
    });

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    expect(mockKeepLocalCopy).toHaveBeenCalledWith({
      files: [{ uri: externalUri, fileName: 'kiko-demo-en.kiko' }],
      destination: 'cachesDirectory',
    });

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace data'));

    await waitFor(() =>
      expect(mockImportData).toHaveBeenCalledWith({
        fileUri: 'file:///local/kiko-demo-en.kiko',
        keyBase64: VALID_KEY,
      }),
    );
  });

  // The file button used to show the whole path/URI. It must show only the
  // file's own name, even when the picker returns no display name.
  it('shows only the file name on the button, not the full path', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///private/var/mobile/Containers/Shared/kiko-demo-uk.kiko', name: undefined },
    ]);

    const { getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));

    expect(await findByText('kiko-demo-uk.kiko')).toBeTruthy();
    expect(queryByText(/private\/var/)).toBeNull();
  });

  // A `.kiko` export made in one language can be imported on a device
  // running another — the imported `settings` row's language must apply
  // BEFORE the success message is composed, so it renders in the restored
  // language, not the pre-import one.
  it('shows the success message in the language restored by the import, not the pre-import language', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockResolvedValue({
      accountsRestored: 2,
      holdingsRestored: 3,
      transactionsRestored: 10,
      languageRestored: 'uk',
      unrestoredCredentials: [],
    });

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace data'));

    expect(await findByText('Імпорт завершено — відновлено рахунків: 2.')).toBeTruthy();
  });

  describe('when a saved key could not be written after the data was restored', () => {
    const pickAndConfirmImport = async () => {
      mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);

      const screen = await renderScreen();

      await fireEvent.press(screen.getByTestId('settings-button-pick-file'));
      await waitFor(() => expect(mockPick).toHaveBeenCalled());
      await fireEvent.changeText(
        screen.getByPlaceholderText('Paste the key from your export'),
        VALID_KEY,
      );
      await fireEvent.press(screen.getByTestId('settings-button-import'));
      await fireEvent.press(await screen.findByText('Replace data'));

      return screen;
    };

    it('shows the success and names the connections to set up again, with no failure alert', async () => {
      mockImportData.mockResolvedValue({
        accountsRestored: 2,
        languageRestored: null,
        unrestoredCredentials: ['monobank', 'binance', 'eodhd'],
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      const { findByText } = await pickAndConfirmImport();

      expect(await findByText('Import complete — 2 accounts restored.')).toBeTruthy();
      expect(
        await findByText(
          'Your data was restored, but the saved keys for Monobank, Binance, EODHD could not be stored on this iPhone. Add them again to reconnect.',
        ),
      ).toBeTruthy();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('writes the message in the restored language', async () => {
      mockImportData.mockResolvedValue({
        accountsRestored: 1,
        languageRestored: 'uk',
        unrestoredCredentials: ['eodhd'],
      });

      const { findByText } = await pickAndConfirmImport();

      expect(
        await findByText(
          'Дані відновлено, але збережені ключі для EODHD не вдалося зберегти на цьому iPhone. Додайте їх ще раз, щоб підключитися знову.',
        ),
      ).toBeTruthy();
    });

    it('shows no such message when every saved key was written', async () => {
      mockImportData.mockResolvedValue({
        accountsRestored: 1,
        languageRestored: null,
        unrestoredCredentials: [],
      });

      const { findByText, queryByText } = await pickAndConfirmImport();

      expect(await findByText('Import complete — 1 accounts restored.')).toBeTruthy();
      expect(queryByText(/could not be stored on this iPhone/)).toBeNull();
    });
  });

  it('shows a wrong-key-specific error when importData throws a decrypt-prefixed error', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockRejectedValue(
      new Error('data-transfer/decrypt: wrong key or corrupted file'),
    );
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace data'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Import failed',
        'The key is wrong, or the file is corrupted.',
      ),
    );
  });

  it('shows the generic invalid-file error when importData throws anything else', async () => {
    mockPick.mockResolvedValue([{ uri: 'file:///picked.kiko', name: 'picked.kiko' }]);
    mockImportData.mockRejectedValue(new Error('unexpected JSON shape'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-pick-file'));
    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), VALID_KEY);
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace data'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Import failed',
        'This does not look like a valid Kiko export file.',
      ),
    );
  });
});
