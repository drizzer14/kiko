import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import TermDepositSection from '../term-deposit-section';
import Box from '../../../../../design-system/components/box';
import Text from '../../../../../design-system/components/text';
import Divider from '../../../../../design-system/components/divider';

import type { TermDepositFormBlockProps } from './term-deposit-form-block.props';

// The `type === 'term_deposit'` details block as its own leaf component,
// keeping its own cognitive-complexity budget separate from the screen's.
const TermDepositFormBlock: FC<TermDepositFormBlockProps> = ({ fields, attemptedSave }) => {
  const { t } = useTranslation();

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.contributions')}</Text>

      <TermDepositSection fields={fields} attemptedSave={attemptedSave} />
    </Box>
  );
};

export default TermDepositFormBlock;
