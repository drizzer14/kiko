import { syncErrorMessage } from './sync-error-message';

describe('syncErrorMessage', () => {
  it('returns the message of an invalid or saveError status', () => {
    expect(syncErrorMessage({ kind: 'invalid', message: 'Invalid token' })).toBe('Invalid token');
    expect(syncErrorMessage({ kind: 'saveError', message: 'Could not save token' })).toBe(
      'Could not save token',
    );
  });

  it('returns nothing for idle, checking and success', () => {
    expect(syncErrorMessage({ kind: 'idle' })).toBeUndefined();
    expect(syncErrorMessage({ kind: 'checking' })).toBeUndefined();
    expect(syncErrorMessage({ kind: 'success', message: 'Connected as Jane Doe' })).toBeUndefined();
  });
});
