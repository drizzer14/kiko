import { match } from 'ts-pattern';

import type { Currency } from '../currency/currency';

export const currencyFromCode = (code: number): Currency | undefined =>
  match(code)
    .with(980, (): Currency => 'UAH')
    .with(840, (): Currency => 'USD')
    .with(978, (): Currency => 'EUR')
    .otherwise(() => undefined);

export const codeFromCurrency = (currency: Currency): number | undefined =>
  match(currency)
    .with('UAH', () => 980)
    .with('USD', () => 840)
    .with('EUR', () => 978)
    .with('BTC', () => undefined)
    .exhaustive();
