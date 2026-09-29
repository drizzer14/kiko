// Semgrep fixture (NEGATIVE): kiko-no-clipboard-set-string must report
// nothing here. A copy goes through copySensitiveText, and a pasteboard read
// stays allowed.
import { copySensitiveText } from '@kiko/clipboard';
import Clipboard from '@react-native-clipboard/clipboard';

export const copyKey = (value: string): void => {
  copySensitiveText(value);
};

export const pasteKey = (): Promise<string> => Clipboard.getString();
