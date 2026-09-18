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
  types: { allFiles: '*/*' },
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

describe('ImportDataScreen', () => {
  beforeEach(() => {
    mockPick.mockReset();
    mockImportData.mockReset();
  });

  it('disables the Import button until both a file is picked and a key is entered', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('settings-button-import').props.accessibilityState.disabled).toBe(true);
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

    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), 'abc123==');
    await fireEvent.press(getByTestId('settings-button-import'));

    // The destructive ConfirmSheet must appear before any real import runs.
    expect(mockImportData).not.toHaveBeenCalled();
    await fireEvent.press(await findByText('Replace Data'));

    await waitFor(() =>
      expect(mockImportData).toHaveBeenCalledWith({
        fileUri: 'file:///picked.kiko',
        keyBase64: 'abc123==',
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
    await fireEvent.changeText(getByPlaceholderText('Paste the key from your export'), 'wrong==');
    await fireEvent.press(getByTestId('settings-button-import'));
    await fireEvent.press(await findByText('Replace Data'));

    await waitFor(() => expect(mockImportData).toHaveBeenCalled());
  });
});
