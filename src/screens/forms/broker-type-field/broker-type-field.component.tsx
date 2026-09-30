import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import SelectField from '@kiko/design-system/components/select-field';
import { type BrokerId, brokerCatalog, brokerIds } from '@kiko/brokers';

import type { BrokerTypeFieldProps } from './broker-type-field.props';

// A thin `SelectField` wrapper, not a `BankTypeField`-style hand-rolled sheet:
// a broker has no capability to show, and no icons, so no logo can stand in
// for a trademark.
const BrokerTypeField: FC<BrokerTypeFieldProps> = ({
  label,
  sheetTitle,
  selected,
  onSelect,
  testID,
}) => {
  const { t } = useTranslation();

  const labels = Object.fromEntries(
    brokerCatalog.map((entry) => [entry.id, entry.displayName ?? t('forms.account.otherBroker')]),
  ) as Record<BrokerId, string>;

  return (
    <Box gap={1}>
      <SelectField
        label={label}
        sheetTitle={sheetTitle}
        options={brokerIds}
        selected={selected}
        onSelect={onSelect}
        labels={labels}
        placeholder={t('forms.account.brokerTypePlaceholder')}
        testID={testID}
      />

      {/* Every broker is named in plain text, so the field says Kiko is not
          affiliated with any of them (kiko-compliance, third-party
          trademarks). */}
      <Text variant="caption" tone="textSecondary">
        {t('forms.account.brokerDisclaimer')}
      </Text>
    </Box>
  );
};

export default BrokerTypeField;
