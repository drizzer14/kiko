// Semgrep fixture (POSITIVE): kiko-no-clipboard-set-string MUST report a
// finding on every pinned line below. Never "fix" this file — see
// kiko-compliance's "5.1.5 / data storage".
import Clipboard from '@react-native-clipboard/clipboard';

export const copyKey = (value: string): void => {
  // EXPECT-FINDING
  Clipboard.setString(value);
};

export const copyKeys = (values: string[]): void => {
  // EXPECT-FINDING
  Clipboard.setStrings(values);
};
