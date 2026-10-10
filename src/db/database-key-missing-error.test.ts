import { DatabaseKeyMissingError } from './database-key-missing-error';

describe('DatabaseKeyMissingError', () => {
  it('carries the exact message', () => {
    expect(new DatabaseKeyMissingError().message).toBe(
      'The database key is missing from the Keychain; the encrypted database was left as is',
    );
  });

  it('carries the exact name', () => {
    expect(new DatabaseKeyMissingError().name).toBe('DatabaseKeyMissingError');
  });

  it('is an instance of both its own class and Error', () => {
    const error = new DatabaseKeyMissingError();

    expect(error).toBeInstanceOf(DatabaseKeyMissingError);
    expect(error).toBeInstanceOf(Error);
  });
});
