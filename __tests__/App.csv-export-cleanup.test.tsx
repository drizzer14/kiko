import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';

// Everything AppRoot calls except the CSV cleanup is stubbed out: this file pins only that
// AppRoot calls it, so the policy's "deleted at the next launch" cannot go false unseen.
const mockUseCsvExportCleanup = jest.fn();
jest.mock('@kiko/data-transfer', () => ({
  useCsvExportCleanup: () => mockUseCsvExportCleanup(),
}));

jest.mock('@kiko/migration/migrations-gate', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@kiko/auth', () => ({
  LockGate: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@kiko/navigation/root-navigator', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@kiko/sync/use-auto-sync', () => ({ useAutoSync: () => undefined }));
jest.mock('@kiko/holdings/lot-recost', () => ({ useLotRecost: () => undefined }));
jest.mock('@kiko/categories/category-rules-repo', () => ({ useMccBackfill: () => undefined }));
jest.mock('@kiko/reminders/use-reminder-scheduler', () => ({
  useReminderScheduler: () => undefined,
}));
jest.mock('@kiko/i18n/use-sync-language-with-settings', () => ({
  useSyncLanguageWithSettings: () => undefined,
}));
jest.mock('@kiko/appearance/use-sync-appearance-with-settings', () => ({
  useSyncAppearanceWithSettings: () => undefined,
}));

import App from '../App';

describe('App', () => {
  beforeEach(() => {
    mockUseCsvExportCleanup.mockReset();
  });

  it('deletes the CSV files an earlier run left behind, as soon as the app opens', async () => {
    await render(<App />);

    expect(mockUseCsvExportCleanup).toHaveBeenCalledTimes(1);
  });
});
