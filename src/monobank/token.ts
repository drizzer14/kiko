import * as Keychain from 'react-native-keychain';

const service = 'pff.monobank.token';

export const saveToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, { service });
};

export const readToken = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service });
  return credentials ? credentials.password : undefined;
};

export const clearToken = async (): Promise<void> => {
  await Keychain.resetGenericPassword({ service });
};
