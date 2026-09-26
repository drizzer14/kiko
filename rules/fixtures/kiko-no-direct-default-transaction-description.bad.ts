import type { TFunction } from 'i18next';
import { defaultTransactionDescription } from '@kiko/transactions/default-description';

// Semgrep fixture (POSITIVE): a blank row's fallback label has ONE owner,
// `transactionRowDescription`. A surface that calls
// `defaultTransactionDescription` itself skips the exchange-leg branch and
// shows "<holding> expense" where the list shows "Exchange to <holding>".
// `kiko-no-direct-default-transaction-description` MUST report the pinned line.
export const placeholderFor = (holdingName: string, t: TFunction): string =>
  // EXPECT-FINDING
  defaultTransactionDescription(holdingName, -1, t);
