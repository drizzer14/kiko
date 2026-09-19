// Semgrep fixture (NEGATIVE): a normal, non-visibility @env build flag read
// and a normal src import must both stay clean under
// `kiko-no-hidden-feature-flag-or-demo-import`.
import { PRICE_ENDPOINT } from '@env';

import type { Money } from '../../src/currency/money';
import { formatMoney } from '../../src/currency/format';

export const priceEndpoint = (): string => PRICE_ENDPOINT;

export const formatted = (money: Money): string => formatMoney(money);
