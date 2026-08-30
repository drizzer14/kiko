import { clearToken, readToken, saveToken } from './token';

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;
  return {
    setGenericPassword: jest.fn(async (username: string, password: string) => {
      store = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async () => store ?? false),
    resetGenericPassword: jest.fn(async () => {
      store = null;
      return true;
    }),
  };
});

describe('monobank token', () => {
  it('saves and reads the token', async () => {
    await saveToken('secret-token');
    expect(await readToken()).toBe('secret-token');
  });

  it('clears the token', async () => {
    await saveToken('secret-token');
    await clearToken();
    expect(await readToken()).toBeUndefined();
  });
});
