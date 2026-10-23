// Semgrep fixture (NEGATIVE, NESTED): a manual mock imports test scaffolding. The rule excludes
// `**/__mocks__/**`, so `kiko-no-test-fixture-import-in-app` MUST report nothing here.
import { NOW } from '../../../../../../src/crypto-sync/binance/binance.pay-test-fixtures';

export const mockNow = (): number => NOW;
