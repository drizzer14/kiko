import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '../../../design-system/unistyles';
// Side-effect import: src/i18n/index.ts calls `i18next.init()` at module
// load. Every test file gets its own fresh module registry, so without this
// import `useTranslation`'s `t()` returns the raw key (e.g.
// "settings.dataExport.exportButton") instead of the real English string
// this suite asserts on — the same reason
// src/screens/settings/settings/settings.screen.test.tsx imports it.
import '../../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';

const mockExportData = jest.fn();
jest.mock('@kiko/data-transfer/export-data', () => ({
  exportData: (...args: unknown[]) => mockExportData(...args),
}));

const mockSetString = jest.fn();
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: (...args: unknown[]) => mockSetString(...args),
}));

const mockShare = jest.fn();
// `Share` off the `react-native` package root resolves via
// `require('./Libraries/Share/Share').default` (node_modules/react-native/index.js),
// so the mock needs the `__esModule: true` + `default` wrapper here to be
// seen at that `.default` access — a bare `{ share: fn }` (no `default` key)
// makes `Share` resolve to `undefined` in the component.
jest.mock('react-native/Libraries/Share/Share', () => ({
  __esModule: true,
  default: { share: (...args: unknown[]) => mockShare(...args) },
}));

import ExportDataScreen from './export-data.screen';

// The installed @testing-library/react-native (14.0.1) ships an ASYNC
// `render` and an ASYNC `fireEvent` (both return Promises, confirmed against
// node_modules/@testing-library/react-native/dist/{render,fire-event}.js).
// Every call site here awaits both, matching the working convention already used
// by src/screens/settings/settings/settings.screen.test.tsx.
const renderScreen = () =>
  render(
    <ExportDataScreen
      navigation={asNavigationProp(navigationSpy())}
      route={asRouteProp('ExportData')}
    />,
  );

describe('ExportDataScreen', () => {
  beforeEach(() => {
    mockExportData.mockReset();
    mockSetString.mockReset();
    mockShare.mockReset();
  });

  it('explains what the include-secrets switch does, in terms of saved passwords and keys', async () => {
    const { findByText } = await renderScreen();

    expect(await findByText('Include saved passwords & keys')).toBeTruthy();
    expect(
      await findByText(
        'Adds your saved Monobank token and Binance API keys to the file, so a restore can keep syncing without reconnecting. Turn this off to export only your data.',
      ),
    ).toBeTruthy();
  });

  it('exports with includeSecrets:false by default, then shows the key and a Copy Key button', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId, findByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));

    await waitFor(() => expect(mockExportData).toHaveBeenCalledWith({ includeSecrets: false }));
    await fireEvent.press(await findByTestId('settings-button-copy-key'));
    expect(mockSetString).toHaveBeenCalledWith('abc123==');
  });

  // Device report: pressing Export could look like it silently did nothing.
  // A successful export must produce a VISIBLE result right away, not rely
  // on the user noticing/scrolling to the key card's own Share File button —
  // so the OS share sheet now opens immediately once the file is ready.
  it('opens the share sheet immediately once a fresh export succeeds, with a file:// URL', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));

    await waitFor(() => expect(mockShare).toHaveBeenCalledWith({ url: 'file:///tmp/x.kiko' }));
  });

  // A share-sheet dismiss/cancel rejects the `Share.share` promise — the
  // expected common case, not an export failure — so it must not surface
  // the export error Alert or leave the key/file state cleared.
  it('does not treat a dismissed/cancelled share sheet as an export failure', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    mockShare.mockRejectedValueOnce(new Error('User did not share'));
    const { getByTestId, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));

    // The key card still renders (the export itself succeeded) and no
    // error Alert copy appears.
    expect(await findByText('Encryption key')).toBeTruthy();
  });

  it('passes includeSecrets:true once the toggle is switched on', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-export-secrets'), 'valueChange', true);
    await fireEvent.press(getByTestId('settings-button-export'));

    await waitFor(() => expect(mockExportData).toHaveBeenCalledWith({ includeSecrets: true }));
  });

  it('shares the generated file when Share File is pressed, as a file:// URL', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId, findByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));
    mockShare.mockClear();
    await fireEvent.press(await findByTestId('settings-button-share-file'));

    // `Share.share`'s `url` needs an actual URL — a bare filesystem path can
    // silently no-op on iOS instead of attaching the file.
    expect(mockShare).toHaveBeenCalledWith({ url: 'file:///tmp/x.kiko' });
  });

  // DEVICE BUG: the primary Export button previously rendered as scroll
  // CONTENT, which pushed it below the fold on a real device — matches the
  // fix already made to the Settings screen's own footer and to
  // ImportDataScreen's primary button.
  it('pins the Export button to the screen footer slot, not the scrolling content', async () => {
    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    const scrollView = getByTestId('screen-scroll-view');

    expect(within(footer).getByTestId('settings-button-export')).toBeTruthy();
    expect(within(scrollView).queryByTestId('settings-button-export')).toBeNull();
  });
});

describe('ExportDataScreen — copy-key feedback', () => {
  beforeEach(() => {
    mockExportData.mockReset();
    mockSetString.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows "Copied" after pressing Copy Key, then reverts to "Copy Key" after the delay', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId, findByTestId, getByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));
    await fireEvent.press(await findByTestId('settings-button-copy-key'));

    expect(getByText('Copied')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(getByText('Copy key')).toBeTruthy();
  });

  // BLOCKING (review): a fresh Export mints a brand-new key, but the button
  // previously kept showing "Copied" from the PRIOR key's copy — misleading,
  // given the "save this key, it will not be shown again" warning, since the
  // new key was never actually copied.
  it('reverts a stale "Copied" label to "Copy Key" when a new export produces a new key', async () => {
    mockExportData.mockResolvedValueOnce({ fileUri: '/tmp/a.kiko', keyBase64: 'keyA==' });
    const { getByTestId, findByTestId, getByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));
    await fireEvent.press(await findByTestId('settings-button-copy-key'));

    expect(getByText('Copied')).toBeTruthy();
    expect(mockSetString).toHaveBeenCalledWith('keyA==');

    mockExportData.mockResolvedValueOnce({ fileUri: '/tmp/b.kiko', keyBase64: 'keyB==' });
    await fireEvent.press(getByTestId('settings-button-export'));

    expect(getByText('Copy key')).toBeTruthy();
  });
});
