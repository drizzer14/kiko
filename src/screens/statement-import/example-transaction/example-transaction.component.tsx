import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_CATEGORY_KEY,
  buildCategoryDisplayMap,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '../../../categories/category-display';
import { Money } from '../../../currency/money';
import { formatDate } from '../../../dates/format';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { categoriesRepo } from '../../../categories/repo';
import { useLiveQuery } from '../../../db/use-live-query';
import { settingsRepo } from '../../../settings/settings.repo';
import Divider from '../../../design-system/components/divider';
import { categoryForMcc } from '../../../monobank/mcc-category';
import TransactionCard from '../../home/transaction-row/transaction-card';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';
import { transactionRowDescription } from '../../../transactions/row-description';

import type { ExampleTransactionProps } from './example-transaction.props';

/**
 * ONE shared row previewing the first parsed transaction — device-feedback-
 * round-F1 items 9/14, F3 item 4/5: shown under the summary table on both
 * `statement-import.screen.tsx` and the column-mapping result section, so
 * the user sees a real example of what will actually be written BEFORE
 * tapping Import, rendered through the SAME `TransactionCard` Home's own
 * `TransactionRow` uses — not a rebuilt one. The category comes from the
 * row's own `mcc` via `categoryForMcc` (the same key `mapParsedTransaction`
 * writes), resolved through the live categories table exactly as Home
 * resolves a real row's category, so an income preview row shows the same
 * icon and income color a Home row would. The title resolves through the
 * SAME `transactionRowDescription` Home uses (F3 fix round 2, N3) — an
 * empty mapped description falls back to the income/expense default label
 * instead of rendering blank; `exchangeCounterpartHoldingId` is always
 * `null` here (an import never creates an exchange-marked row). The footer
 * shows the category title and the row's own date (`formatDate`) — the
 * user's only per-row check that the chosen date format/column is right —
 * reusing `TransactionCard`'s existing optional `footerMeta`/
 * `footerTrailing` props, so Home (which passes its own footer content) is
 * unaffected. Owns its own `Divider`s above and below (F3 item 5), so a
 * caller renders just `<ExampleTransaction ... />`.
 */
const ExampleTransaction: FC<ExampleTransactionProps> = ({ transaction, holdingName, testID }) => {
  const { t } = useTranslation();
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
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

        <TransactionCard
          title={title}
          categoryIcon={category.icon}
          categoryIconColor={resolveCategoryColor(category.color, categoryKey)}
          categoryAccessibilityLabel={category.title}
          money={Money.of(transaction.currency, transaction.amountMinorUnits)}
          footerMeta={category.title}
          footerTrailing={formatDate(transaction.timeSeconds * 1000)}
        />
      </Box>

      <Divider testID="example-transaction-divider" />
    </Box>
  );
};

export default ExampleTransaction;
