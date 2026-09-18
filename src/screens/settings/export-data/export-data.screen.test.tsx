import { fireEvent, render, waitFor } from '@testing-library/react-native';
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
// node_modules/@testing-library/react-native/dist/{render,fire-event}.js) —
// unlike the brief's Step 1 snippet, which assumes the older sync API. Every
// call site here awaits both, matching the working convention already used
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

  it('exports with includeSecrets:false by default, then shows the key and a Copy Key button', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId, findByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));

    await waitFor(() => expect(mockExportData).toHaveBeenCalledWith({ includeSecrets: false }));
    await fireEvent.press(await findByTestId('settings-button-copy-key'));
    expect(mockSetString).toHaveBeenCalledWith('abc123==');
  });

  it('passes includeSecrets:true once the toggle is switched on', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId } = await renderScreen();

    await fireEvent(getByTestId('settings-switch-export-secrets'), 'valueChange', true);
    await fireEvent.press(getByTestId('settings-button-export'));

    await waitFor(() => expect(mockExportData).toHaveBeenCalledWith({ includeSecrets: true }));
  });

  it('shares the generated file when Share File is pressed', async () => {
    mockExportData.mockResolvedValue({ fileUri: '/tmp/x.kiko', keyBase64: 'abc123==' });
    const { getByTestId, findByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-export'));
    await fireEvent.press(await findByTestId('settings-button-share-file'));

    expect(mockShare).toHaveBeenCalledWith({ url: '/tmp/x.kiko' });
  });
});
