// Semgrep fixture (NEGATIVE, NESTED): a module inside a `__fixtures__` folder imports test
// scaffolding. The rule excludes `**/__fixtures__/**`, so `kiko-no-test-fixture-import-in-app`
// MUST report nothing here. Positive cases stay in the flat
// `kiko-no-test-fixture-import-in-app.bad.ts`: an exclude glob matches at any depth, so a positive
// fixture under this path would prove nothing.
import { NOW } from '../../../../../../src/crypto-sync/binance/binance.pay-test-fixtures';

export const fixtureNow = (): number => NOW;
