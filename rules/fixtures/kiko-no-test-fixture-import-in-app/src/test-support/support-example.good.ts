// Semgrep fixture (NEGATIVE, NESTED): a test-support module imports test scaffolding. The rule
// excludes `**/test-support/**`, so `kiko-no-test-fixture-import-in-app` MUST report nothing here.
// Positive cases stay in the flat `kiko-no-test-fixture-import-in-app.bad.ts`: an exclude glob
// matches at any depth, so a positive fixture under this path would prove nothing.
import { NOW } from '../../../../../src/crypto-sync/binance/binance.pay-test-fixtures';

export const fixtureNow = (): number => NOW;
