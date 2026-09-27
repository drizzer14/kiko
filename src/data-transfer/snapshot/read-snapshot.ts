// src/data-transfer/snapshot/read-snapshot.ts
import {
  accounts,
  bondRegister,
  categories,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  holdings,
  pricePoints,
  settings,
  syncState,
  transactions,
  database,
} from '@kiko/db';
import { asc } from 'drizzle-orm';

import type { DataSnapshot } from './data-snapshot';

/**
 * A full, ordered dump of every logical table — one `await`ed select per
 * table, in a FIXED sequential order (never `Promise.all`: the test suite's
 * mock keys off this exact call order). Each table is ordered by its own
 * primary key (or, for the two-key rate tables, its natural composite key)
 * so a re-export of unchanged data always serializes byte-identical JSON.
 */
export const readDataSnapshot = async (): Promise<DataSnapshot> => ({
  accounts: await database.select().from(accounts).orderBy(asc(accounts.id)),
  holdings: await database.select().from(holdings).orderBy(asc(holdings.id)),
  transactions: await database.select().from(transactions).orderBy(asc(transactions.id)),
  currencyRates: await database
    .select()
    .from(currencyRates)
    .orderBy(asc(currencyRates.base), asc(currencyRates.quote)),
  currencyRateHistory: await database
    .select()
    .from(currencyRateHistory)
    .orderBy(
      asc(currencyRateHistory.base),
      asc(currencyRateHistory.quote),
      asc(currencyRateHistory.day),
    ),
  settings: await database.select().from(settings).orderBy(asc(settings.id)),
  syncState: await database.select().from(syncState).orderBy(asc(syncState.accountId)),
  categories: await database.select().from(categories).orderBy(asc(categories.key)),
  categoryOverrides: await database
    .select()
    .from(categoryOverrides)
    .orderBy(asc(categoryOverrides.normalizedName)),
  pricePoints: await database
    .select()
    .from(pricePoints)
    .orderBy(asc(pricePoints.instrument), asc(pricePoints.day)),
  bondRegister: await database.select().from(bondRegister).orderBy(asc(bondRegister.isin)),
});
