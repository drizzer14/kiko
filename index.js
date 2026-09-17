/**
 * @format
 */

// SECURITY-CRITICAL: this import MUST be first, before any other import
// that could touch crypto (including transitively, through `App`). It
// polyfills `global.crypto.getRandomValues` with a real CSPRNG on-device, so
// bunq's node-forge RSA binding (`src/bunq/crypto/node-forge-crypto.ts`)
// never falls back to node-forge's weak `Math.random` PRNG when it
// generates the client's bank-auth keypair. Never move this import or add
// another import above it.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
