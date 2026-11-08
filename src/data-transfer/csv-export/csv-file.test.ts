// A backing value (not a literal) so a test can flip the trailing slash of the directory constant.
let mockTemporaryDirectoryPath = '/tmp/';
let mockDirectory: string[] = [];
const mockWriteFile = jest.fn();
const mockReadDir = jest.fn();
const mockUnlink = jest.fn();
jest.mock('react-native-fs', () => ({
  get TemporaryDirectoryPath() {
    return mockTemporaryDirectoryPath;
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readDir: (...args: unknown[]) => mockReadDir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

import {
  deleteCsvExports,
  deleteCsvExportsIfIdle,
  shareCsvExport,
  writeCsvExport,
} from './csv-file';

const LEFTOVER = 'kiko-transactions-1700000000000.csv';
const OTHER_LEFTOVER = 'kiko-transactions-1700000000001.csv';

type Settle = { resolve: () => void; reject: (error: Error) => void; promise: Promise<void> };

const pendingShare = (): Settle => {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { resolve, reject, promise };
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('writeCsvExport', () => {
  beforeEach(() => {
    mockTemporaryDirectoryPath = '/tmp/';
    mockWriteFile.mockReset().mockResolvedValue(undefined);
  });

  it('writes the text as UTF-8 to a kiko-transactions file in the temporary directory', async () => {
    const path = await writeCsvExport('﻿Date\r\n');

    expect(path).toMatch(/^\/tmp\/kiko-transactions-\d+\.csv$/);
    expect(mockWriteFile).toHaveBeenCalledWith(path, '﻿Date\r\n', 'utf8');
  });

  it('joins the path when the directory constant has no trailing slash', async () => {
    mockTemporaryDirectoryPath = '/tmp';

    expect(await writeCsvExport('x')).toMatch(/^\/tmp\/kiko-transactions-\d+\.csv$/);
  });

  it('joins the path without a doubled slash when the constant has one', async () => {
    mockTemporaryDirectoryPath = '/var/tmp/';

    expect(await writeCsvExport('x')).toMatch(/^\/var\/tmp\/kiko-transactions-\d+\.csv$/);
  });

  it('rejects when the write fails, and deletes the partial file', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'));
    mockUnlink.mockReset().mockResolvedValue(undefined);

    await expect(writeCsvExport('x')).rejects.toThrow('disk full');

    expect(mockUnlink).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0]);
  });

  it('rejects with the write error even when the delete of the partial file fails too', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'));
    mockUnlink.mockReset().mockRejectedValue(new Error('no file'));

    await expect(writeCsvExport('x')).rejects.toThrow('disk full');
  });
});

describe('the CSV file lifecycle', () => {
  beforeEach(() => {
    mockTemporaryDirectoryPath = '/tmp/';
    mockDirectory = [LEFTOVER, OTHER_LEFTOVER, 'kiko-export-1.kiko', 'notes.csv', 'photo.jpg'];
    mockReadDir
      .mockReset()
      .mockImplementation(async () =>
        mockDirectory.map((name) => ({ name, path: `/tmp/${name}` })),
      );
    mockUnlink.mockReset().mockImplementation(async (path: string) => {
      mockDirectory = mockDirectory.filter((name) => `/tmp/${name}` !== path);
    });
  });

  describe('deleteCsvExports', () => {
    it('deletes every leftover kiko-transactions CSV and nothing else', async () => {
      await deleteCsvExports();

      expect(mockDirectory).toEqual(['kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });

    it('keeps a .kiko file even when its name starts the same way', async () => {
      mockDirectory = ['kiko-transactions-1.kiko', 'kiko-export-1.kiko'];

      await deleteCsvExports();

      expect(mockDirectory).toEqual(['kiko-transactions-1.kiko', 'kiko-export-1.kiko']);
    });

    it('does not reject when the folder cannot be read', async () => {
      mockReadDir.mockRejectedValue(new Error('no folder'));

      await expect(deleteCsvExports()).resolves.toBeUndefined();
    });

    it('does not reject when the folder read is missing altogether', async () => {
      mockReadDir.mockImplementation(() => {
        throw new TypeError('readDir is not a function');
      });

      await expect(deleteCsvExports()).resolves.toBeUndefined();
    });

    it('goes on to the other files when one delete fails', async () => {
      mockUnlink.mockImplementationOnce(async () => {
        throw new Error('busy');
      });

      await expect(deleteCsvExports()).resolves.toBeUndefined();

      expect(mockDirectory).toEqual([LEFTOVER, 'kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });
  });

  describe('shareCsvExport', () => {
    it('deletes its file when the share resolves', async () => {
      await shareCsvExport(`/tmp/${LEFTOVER}`, async () => undefined);

      expect(mockDirectory).not.toContain(LEFTOVER);
    });

    it('deletes its file and rejects with the error when the share rejects', async () => {
      await expect(
        shareCsvExport(`/tmp/${LEFTOVER}`, async () => {
          throw new Error('share failed');
        }),
      ).rejects.toThrow('share failed');

      expect(mockDirectory).not.toContain(LEFTOVER);
    });

    it('keeps the file while the share is pending', async () => {
      const share = pendingShare();
      const running = shareCsvExport(`/tmp/${LEFTOVER}`, () => share.promise);
      await flush();

      expect(mockDirectory).toContain(LEFTOVER);

      share.resolve();
      await running;
    });

    it('deletes every leftover once the last share settles', async () => {
      await shareCsvExport(`/tmp/${LEFTOVER}`, async () => undefined);

      expect(mockDirectory).toEqual(['kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });

    it('deletes the leftovers only when the second of two pending shares settles', async () => {
      const first = pendingShare();
      const second = pendingShare();
      const runningFirst = shareCsvExport(`/tmp/${LEFTOVER}`, () => first.promise);
      const runningSecond = shareCsvExport(`/tmp/${OTHER_LEFTOVER}`, () => second.promise);
      mockDirectory.push('kiko-transactions-1700000000002.csv');

      first.resolve();
      await runningFirst;

      expect(mockDirectory).toEqual([
        OTHER_LEFTOVER,
        'kiko-export-1.kiko',
        'notes.csv',
        'photo.jpg',
        'kiko-transactions-1700000000002.csv',
      ]);

      second.reject(new Error('second failed'));
      await expect(runningSecond).rejects.toThrow('second failed');

      expect(mockDirectory).toEqual(['kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });

    it('does not reject when the delete of its own file fails', async () => {
      mockUnlink.mockRejectedValue(new Error('busy'));

      await expect(
        shareCsvExport(`/tmp/${LEFTOVER}`, async () => undefined),
      ).resolves.toBeUndefined();
    });
  });

  describe('deleteCsvExportsIfIdle', () => {
    it('deletes the leftovers with no share in flight', async () => {
      await deleteCsvExportsIfIdle();

      expect(mockDirectory).toEqual(['kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });

    it('deletes nothing while a share is pending, and everything after it settles', async () => {
      const share = pendingShare();
      const running = shareCsvExport(`/tmp/${LEFTOVER}`, () => share.promise);

      await deleteCsvExportsIfIdle();

      expect(mockDirectory).toContain(LEFTOVER);
      expect(mockDirectory).toContain(OTHER_LEFTOVER);

      share.resolve();
      await running;

      expect(mockDirectory).toEqual(['kiko-export-1.kiko', 'notes.csv', 'photo.jpg']);
    });
  });
});
