import Clipboard from '@react-native-clipboard/clipboard';

// The one pasteboard write in the app, so a local-only, expiring copy can
// later replace this body without touching a caller.
// Known limit: the value goes to the general pasteboard with no expiry, and
// Universal Clipboard can sync it; a local-only expiring copy needs a native
// module.
export const copySensitiveText = (value: string): void => {
  Clipboard.setString(value);
};
