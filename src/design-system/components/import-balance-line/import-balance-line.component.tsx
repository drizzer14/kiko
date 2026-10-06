import type { FC } from 'react';
import { match } from 'ts-pattern';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';

import Box from '../box';
import Text from '../text';

import type { ImportBalanceLineProps } from './import-balance-line.props';

/**
 * The statement preview's one-line answer to "what will my balance be": the
 * figure a closing balance sets, the change the rows make, or that nothing moves
 * it (`previewImportBalance`). Amounts go through the shared money formatter in
 * the holding's own currency.
 */
const ImportBalanceLine: FC<ImportBalanceLineProps> = ({ preview, testID }) => {
  const { t } = useTranslation();
  const amountOf = (minorUnits: number): string =>
    formatMoney(Money.of(preview.currency, minorUnits), activeLocale());

  const message = match(preview)
    .with({ kind: 'set' }, ({ minorUnits, bankMinorUnits, asOfSeconds }) =>
      minorUnits === bankMinorUnits
        ? t('statementImport.balanceWillBeSet', { amount: amountOf(minorUnits) })
        : t('statementImport.balanceWillBeSetWithLater', {
            amount: amountOf(minorUnits),
            bankAmount: amountOf(bankMinorUnits),
            date: formatDate(asOfSeconds * 1000),
          }),
    )
    .with({ kind: 'change' }, ({ fromMinorUnits, toMinorUnits }) =>
      t('statementImport.balanceWillChange', {
        from: amountOf(fromMinorUnits),
        to: amountOf(toMinorUnits),
      }),
    )
    .with({ kind: 'stays' }, ({ minorUnits }) =>
      t('statementImport.balanceStays', { amount: amountOf(minorUnits) }),
    )
    .exhaustive();

  return (
    <Box testID={testID}>
      <Text variant="body">{message}</Text>
    </Box>
  );
};

export default ImportBalanceLine;
