/**
 * @format
 */

// SECURITY-CRITICAL: this import MUST be first, before any other import
// that could touch crypto (including transitively, through `App`). It
// polyfills `global.crypto.getRandomValues` with a real CSPRNG on-device, so
// `@noble/ciphers`' `randomBytes()` (`src/data-transfer/crypto/generate-key.ts`,
// the export feature's fresh AES-256-GCM key) throws instead of silently
// degrading if this polyfill is ever missing — see
// `@noble/ciphers/utils.js`'s `randomBytes` doc comment: it requires
// `crypto.getRandomValues` and refuses to run without it. Never move this
// import or add another import above it.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
