import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';

import Box from '../box';
import Text from '../text';
import Divider from '../divider';
import LoadingState from '../loading-state';
import {
  DEFAULT_CATEGORY_KEY,
  buildCategoryDisplayMap,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '../../../categories/category-display';
import { Money } from '../../../currency/money';
import TransactionCard from '../transaction-card';
import { formatDate } from '../../../dates/format';
import { categoriesRepo } from '../../../categories/repo';
import { useDataReady } from '../../../db/use-data-ready';
import { useLiveQuery } from '../../../db/use-live-query';
import { settingsRepo } from '../../../settings/settings.repo';
import { categoryForMcc } from '../../../monobank/mcc-category';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';
import { transactionRowDescription } from '../../../transactions/row-description';

import type { ExampleTransactionProps } from './example-transaction.props';

/**
 * ONE shared row previewing the first parsed transaction — shown under the
 * summary table on both
 * `statement-import.screen.tsx` and the column-mapping result section, so
 * the user sees a real example of what will actually be written BEFORE
 * tapping Import, rendered through the SAME `TransactionCard` Home's own
 * `TransactionRow` uses — not a rebuilt one. The category comes from the
 * row's own `mcc` via `categoryForMcc` (the same key `mapParsedTransaction`
 * writes), resolved through the live categories table exactly as Home
 * resolves a real row's category, so an income preview row shows the same
 * icon and income color a Home row would. The title resolves through the
 * SAME `transactionRowDescription` Home uses — an
 * empty mapped description falls back to the income/expense default label
 * instead of rendering blank; `exchangeCounterpartHoldingId` is always
 * `null` here (an import never creates an exchange-marked row). The footer
 * shows the category title and the row's own date (`formatDate`) — the
 * user's only per-row check that the chosen date format/column is right —
 * reusing `TransactionCard`'s existing optional `footerMeta`/
 * `footerTrailing` props, so Home (which passes its own footer content) is
 * unaffected. Owns its own `Divider`s above and below, so a
 * caller renders just `<ExampleTransaction ... />`.
 */
const ExampleTransaction: FC<ExampleTransactionProps> = ({ transaction, holdingName, testID }) => {
  const { t } = useTranslation();
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(settingsRepo.getQuery(), [
    'settings',
  ]);
  // The category icon/title this row shows must never render the (possibly
  // wrong) default-category fallback while categories/settings is still on
  // its own first load (kiko-architecture's useLiveQuery consumer rule) — a
  // single row inside an already-loaded parent screen, so it shows the
  // shared LoadingState in place of the card rather than gating the whole
  // parent.
  const isReady = useDataReady(categoriesLoading, settingsLoading);
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const categoryByKey = buildCategoryDisplayMap(categories);
  const rawCategory = foldMap(maybe(transaction.mcc), categoryForMcc) ?? null;
  const category = resolveCategoryDisplay(rawCategory, categoryByKey, defaultCategoryKey);
  const categoryKey = resolveCategoryKey(rawCategory, categoryByKey, defaultCategoryKey);
  const title = transactionRowDescription({
    transaction: {
      description: transaction.description,
      amountMinorUnits: transaction.amountMinorUnits,
      exchangeCounterpartHoldingId: null,
    },
    holdingName: holdingName ?? '',
    holdingNameById: new Map(),
    t,
  });

  return (
    <Box gap={3} testID={testID}>
      <Divider testID="example-transaction-divider" />

      <Box gap={1}>
        <Text variant="caption" tone="textSecondary">
          {t('statementImport.exampleTransaction')}
        </Text>

        {isReady ? (
          <TransactionCard
            title={title}
            categoryIcon={category.icon}
            categoryIconColor={resolveCategoryColor(category.color, categoryKey)}
            categoryAccessibilityLabel={category.title}
            money={Money.of(transaction.currency, transaction.amountMinorUnits)}
            footerMeta={category.title}
            footerTrailing={formatDate(transaction.timeSeconds * 1000)}
          />
        ) : (
          <LoadingState testID="example-transaction-loading" />
        )}
      </Box>

      <Divider testID="example-transaction-divider" />
    </Box>
  );
};

export default ExampleTransaction;
