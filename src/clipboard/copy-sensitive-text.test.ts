import Clipboard from '@react-native-clipboard/clipboard';

import { copySensitiveText } from './copy-sensitive-text';

describe('copySensitiveText', () => {
  it('writes the value to the pasteboard once', () => {
    copySensitiveText('abc123==');

    expect(jest.mocked(Clipboard).setString).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Clipboard).setString).toHaveBeenCalledWith('abc123==');
  });
});
