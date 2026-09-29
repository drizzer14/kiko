import { authenticate } from '../biometrics';

import { confirmOwner } from './confirm-owner';

jest.mock('../biometrics');

const mockAuthenticate = authenticate as jest.Mock;

describe('confirmOwner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls authenticate with the exact reason it was given', async () => {
    mockAuthenticate.mockResolvedValue({ kind: 'success' });

    await confirmOwner('Turn off app lock');

    expect(mockAuthenticate).toHaveBeenCalledWith('Turn off app lock');
  });

  it.each([
    ['success', { kind: 'confirmed' }],
    // confirmOwner only reports noPasscode; it does not decide whether that
    // is a refusal — each caller does (turning the lock off proceeds on it,
    // exporting secrets refuses).
    ['passcodeNotSet', { kind: 'noPasscode' }],
    ['cancelled', { kind: 'cancelled' }],
    ['lockout', { kind: 'failed', hintKey: 'auth.hint.lockout' }],
    ['failed', { kind: 'failed', hintKey: 'auth.hint.failed' }],
  ])('maps AuthResult kind %s to %j', async (kind, expected) => {
    mockAuthenticate.mockResolvedValue({ kind, code: undefined });

    expect(await confirmOwner('reason')).toEqual(expected);
  });
});
