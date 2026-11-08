import { Alert, findNodeHandle } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it.
import { mockFindNodeHandle } from '@kiko/test-support/node-handles';
import {
  accountRow,
  holdingRow,
  transactionRow,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

let mockDirectory: string[] = [];
let mockWriteFails = false;
const mockWriteFile = jest.fn();
jest.mock('react-native-fs', () => ({
  TemporaryDirectoryPath: '/tmp/',
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readDir: async () => mockDirectory.map((name) => ({ name, path: `/tmp/${name}` })),
  unlink: async (path: string) => {
    mockDirectory = mockDirectory.filter((name) => `/tmp/${name}` !== path);
  },
}));

const mockConfirmOwner = jest.fn();
jest.mock('@kiko/auth/confirm-owner', () => ({
  confirmOwner: (...args: unknown[]) => mockConfirmOwner(...args),
}));

// Read when the mocked snapshot is asked for, after the imports above have run.
const mockSnapshot = () => ({
  accounts: [accountRow({ id: 'bank', kind: 'bank', name: 'Main bank' })],
  holdings: [holdingRow({ id: 'card', accountId: 'bank', name: 'Card' })],
  transactions: [
    transactionRow({ id: 'coffee', holdingId: 'card', description: 'Coffee', source: 'manual' }),
  ],
  categories: [],
  settings: [],
});
jest.mock('@kiko/data-transfer/snapshot/read-snapshot', () => ({
  readDataSnapshot: async () => mockSnapshot(),
}));

// Under Jest `findNodeHandle` is always null; this gives each host its own number so the anchor a
// share call carries can be told apart (see src/test-support/node-handles.ts).
jest.mock('react-native/Libraries/ReactNative/RendererProxy', () => ({
  ...jest.requireActual('react-native/Libraries/ReactNative/RendererProxy'),
  findNodeHandle: (node: unknown) => mockFindNodeHandle(node),
}));

const mockShare = jest.fn();
jest.mock('react-native/Libraries/Share/Share', () => ({
  __esModule: true,
  default: { share: (...args: unknown[]) => mockShare(...args) },
}));

import ExportCsvScreen from './export-csv.screen';

const LEFTOVER = 'kiko-transactions-1.csv';

const csvFilesLeft = (): string[] =>
  mockDirectory.filter((name) => name.startsWith('kiko-transactions-') && name.endsWith('.csv'));

const renderScreen = () =>
  render(
    <ExportCsvScreen
      navigation={asNavigationProp(navigationSpy())}
      route={asRouteProp('ExportCsv')}
    />,
  );

const pressShare = async (screen: Awaited<ReturnType<typeof renderScreen>>) => {
  await fireEvent.press(screen.getByTestId('settings-button-export-csv'));
};

const pendingShare = () => {
  let finish: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { promise, finish };
};

describe('ExportCsvScreen', () => {
  beforeEach(() => {
    mockDirectory = [LEFTOVER, 'kiko-export-1.kiko'];
    mockWriteFails = false;
    mockWriteFile.mockReset().mockImplementation(async (path: string) => {
      mockDirectory.push(path.replace('/tmp/', ''));

      if (mockWriteFails) {
        throw new Error('disk full');
      }
    });
    mockConfirmOwner.mockReset().mockResolvedValue({ kind: 'confirmed' });
    mockShare.mockReset().mockResolvedValue({ action: 'sharedAction' });
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes the leftover CSV files when it opens with no share in flight', async () => {
    await renderScreen();

    await waitFor(() => expect(csvFilesLeft()).toEqual([]));
    expect(mockDirectory).toEqual(['kiko-export-1.kiko']);
  });

  it('states the warning, what the file holds and that it is no backup before any action', async () => {
    const { getByText } = await renderScreen();

    expect(getByText(i18n.t('settings.csvExport.warning'))).toBeTruthy();
    expect(getByText(i18n.t('settings.csvExport.contents'))).toBeTruthy();
    expect(getByText(i18n.t('settings.csvExport.notBackup'))).toBeTruthy();
    expect(mockConfirmOwner).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('names the card mask and the other person in what the file holds', () => {
    const contents = i18n.t('settings.csvExport.contents');

    expect(contents).toContain('card');
    expect(contents).toContain('another person');
  });

  it('shows no re-share button, as the backup screen does', async () => {
    const { queryByTestId, queryByText } = await renderScreen();

    expect(queryByTestId('settings-button-share-file')).toBeNull();
    expect(queryByText(i18n.t('settings.dataExport.shareFile'))).toBeNull();
  });

  describe.each([
    ['confirmed', { kind: 'confirmed' }],
    ['noPasscode', { kind: 'noPasscode' }],
  ])('when the owner prompt gives %s', (_name, owner) => {
    it('writes the file, shares it and deletes it', async () => {
      mockConfirmOwner.mockResolvedValue(owner);
      const screen = await renderScreen();
      await waitFor(() => expect(csvFilesLeft()).toEqual([]));

      await pressShare(screen);

      await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(csvFilesLeft()).toEqual([]));
      expect(mockConfirmOwner).toHaveBeenCalledWith(i18n.t('auth.reason.exportCsv'));
    });
  });

  it('writes nothing when the owner cancels', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'cancelled' });
    const screen = await renderScreen();

    await pressShare(screen);

    await waitFor(() => expect(mockConfirmOwner).toHaveBeenCalled());
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('writes nothing and tells why when the owner check fails', async () => {
    mockConfirmOwner.mockResolvedValue({ kind: 'failed', hintKey: 'auth.hint.failed' });
    const screen = await renderScreen();

    await pressShare(screen);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        i18n.t('auth.reauth.failedTitle'),
        i18n.t('auth.hint.failed'),
      ),
    );
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('shares the file by its file URL, anchored on the button', async () => {
    const screen = await renderScreen();

    await pressShare(screen);

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const [writtenPath, text] = mockWriteFile.mock.calls[0] as [string, string];
    expect(mockShare).toHaveBeenCalledWith(
      { url: `file://${writtenPath}` },
      { anchor: findNodeHandle(screen.getByTestId('settings-button-export-csv')) },
    );
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('Coffee');
  });

  it('deletes the file when the share rejects, and says it failed', async () => {
    mockShare.mockRejectedValue(new Error('share failed'));
    const screen = await renderScreen();
    await waitFor(() => expect(csvFilesLeft()).toEqual([]));

    await pressShare(screen);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        i18n.t('settings.csvExport.errorTitle'),
        i18n.t('settings.csvExport.errorMessage'),
      ),
    );
    expect(csvFilesLeft()).toEqual([]);
  });

  it('deletes the partial file when the write fails, shares nothing and says it failed', async () => {
    mockWriteFails = true;
    const screen = await renderScreen();
    await waitFor(() => expect(csvFilesLeft()).toEqual([]));

    await pressShare(screen);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(Alert.alert).toHaveBeenCalledWith(
      i18n.t('settings.csvExport.errorTitle'),
      i18n.t('settings.csvExport.errorMessage'),
    );
    expect(mockShare).not.toHaveBeenCalled();
    expect(csvFilesLeft()).toEqual([]);
  });

  it('blocks a second press while the first export is running', async () => {
    const share = pendingShare();
    mockShare.mockReturnValue(share.promise);
    const screen = await renderScreen();

    await fireEvent.press(screen.getByTestId('settings-button-export-csv'));
    await fireEvent.press(screen.getByTestId('settings-button-export-csv'));

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    expect(mockConfirmOwner).toHaveBeenCalledTimes(1);

    await act(async () => {
      share.finish();
    });
  });

  it('keeps the file for a share still open when the screen mounts again, and deletes it after', async () => {
    const share = pendingShare();
    mockShare.mockReturnValue(share.promise);
    const first = await renderScreen();
    await pressShare(first);
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    await first.unmount();
    const writtenName = (mockWriteFile.mock.calls[0][0] as string).replace('/tmp/', '');

    await renderScreen();
    await act(async () => {});

    expect(mockDirectory).toContain(writtenName);

    await act(async () => {
      share.finish();
    });

    await waitFor(() => expect(csvFilesLeft()).toEqual([]));
  });

  it('keeps the file for a write still open when the screen mounts again, then shares and deletes it', async () => {
    const write = pendingShare();
    mockWriteFile.mockImplementation(async (path: string) => {
      mockDirectory.push(path.replace('/tmp/', ''));
      await write.promise;
    });
    const first = await renderScreen();
    await waitFor(() => expect(csvFilesLeft()).toEqual([]));
    await pressShare(first);
    await waitFor(() => expect(mockWriteFile).toHaveBeenCalledTimes(1));
    await first.unmount();
    const writtenName = (mockWriteFile.mock.calls[0][0] as string).replace('/tmp/', '');

    await renderScreen();
    await act(async () => {});

    expect(mockDirectory).toContain(writtenName);

    await act(async () => {
      write.finish();
    });

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(csvFilesLeft()).toEqual([]));
  });

  describe('under the Ukrainian language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('writes the semicolon dialect with the Ukrainian header', async () => {
      const screen = await renderScreen();

      await pressShare(screen);

      await waitFor(() => expect(mockWriteFile).toHaveBeenCalledTimes(1));
      const text = mockWriteFile.mock.calls[0][1] as string;
      expect(text).toContain('Дата;Рахунок;Актив;Сума');
    });
  });
});
