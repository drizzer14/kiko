const mockSharedContainerPath = jest.fn();
const mockCopyFile = jest.fn();
const mockFileExists = jest.fn();
const mockDeleteFile = jest.fn();
const mockReadTextFile = jest.fn();
const mockWriteTextFile = jest.fn();

const withNative = () =>
  jest.doMock('react-native', () => ({
    NativeModules: {
      WidgetBridge: {
        sharedContainerPath: mockSharedContainerPath,
        copyFile: mockCopyFile,
        fileExists: mockFileExists,
        deleteFile: mockDeleteFile,
        readTextFile: mockReadTextFile,
        writeTextFile: mockWriteTextFile,
      },
    },
  }));

describe('migrationBridge', () => {
  afterEach(() => jest.resetModules());

  it('forwards sharedContainerPath to the native module', async () => {
    withNative();
    mockSharedContainerPath.mockResolvedValue('/container');
    const { migrationBridge } = require('./migration-bridge');

    await expect(migrationBridge.sharedContainerPath('group.com.dmytro.pff')).resolves.toBe(
      '/container',
    );
    expect(mockSharedContainerPath).toHaveBeenCalledWith('group.com.dmytro.pff');
  });

  it('coerces the native fileExists result to a boolean', async () => {
    withNative();
    mockFileExists.mockResolvedValue(true);
    const { migrationBridge } = require('./migration-bridge');

    await expect(migrationBridge.fileExists('/container/migration-export.db')).resolves.toBe(true);
  });

  it('throws a clear error when the native module is unavailable (e.g. under Jest without the module)', async () => {
    jest.doMock('react-native', () => ({ NativeModules: {} }));
    const { migrationBridge } = require('./migration-bridge');

    await expect(migrationBridge.fileExists('/x')).rejects.toThrow(
      'WidgetBridge native module is unavailable',
    );
  });
});
