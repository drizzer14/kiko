import { APP_LOCK_ENABLED, DB_ENCRYPTION_ENABLED } from './db-config';

/**
 * These two flags are the app's two most important security controls. Flipping
 * either one off ships a build with a plaintext SQLite database
 * (`src/db/client.ts`'s `kiko.db` path) or with no biometric gate at all, and
 * neither failure is visible in the UI. Both migrations they gated are long
 * complete, so there is no supported reason to turn either off in a shipping
 * build. This test exists so that doing it fails here instead of on a device.
 */
describe('database and app-lock master switches', () => {
  it('keeps database encryption on', () => {
    expect(DB_ENCRYPTION_ENABLED).toBe(true);
  });

  it('keeps the app lock on', () => {
    expect(APP_LOCK_ENABLED).toBe(true);
  });
});
