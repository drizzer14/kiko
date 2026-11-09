let mockDirectory: string[] = [];
const mockReadDir = jest.fn();
jest.mock('react-native-fs', () => ({
  TemporaryDirectoryPath: '/tmp/',
  readDir: (...args: unknown[]) => mockReadDir(...args),
  unlink: async (path: string) => {
    mockDirectory = mockDirectory.filter((name) => `/tmp/${name}` !== path);
  },
}));

import { renderHook, waitFor } from '@testing-library/react-native';

import { useCsvExportCleanup } from './use-csv-export-cleanup';

describe('useCsvExportCleanup', () => {
  beforeEach(() => {
    mockDirectory = ['kiko-transactions-1.csv', 'kiko-export-1.kiko'];
    mockReadDir
      .mockReset()
      .mockImplementation(async () =>
        mockDirectory.map((name) => ({ name, path: `/tmp/${name}` })),
      );
  });

  it('deletes the leftover CSV files once at mount, with no screen mounted', async () => {
    await renderHook(() => useCsvExportCleanup());

    await waitFor(() => expect(mockDirectory).toEqual(['kiko-export-1.kiko']));
    expect(mockReadDir).toHaveBeenCalledTimes(1);
  });

  it('does not delete again on a rerender', async () => {
    const { rerender } = await renderHook(() => useCsvExportCleanup());
    await waitFor(() => expect(mockDirectory).toEqual(['kiko-export-1.kiko']));

    await rerender({});
    await rerender({});

    expect(mockReadDir).toHaveBeenCalledTimes(1);
  });
});
