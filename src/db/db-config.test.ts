import { DB_ENCRYPTION_ENABLED } from './db-config';

/**
 * This is the app's most important security control. Flipping it off ships a
 * build with a plaintext SQLite database (`src/db/client.ts`'s `kiko.db`
 * path), which is not visible in the UI. The migration it gated is long
 * complete, so there is no supported reason to turn it off in a shipping
 * build. This test exists so that doing it fails here instead of on a device.
 */
describe('database master switch', () => {
  it('keeps database encryption on', () => {
    expect(DB_ENCRYPTION_ENABLED).toBe(true);
  });
});
