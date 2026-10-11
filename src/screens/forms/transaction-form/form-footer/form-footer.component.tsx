import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Button from '@kiko/design-system/components/button';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';

import type { FormFooterProps } from './form-footer.props';

// The form's pinned footer: Save, plus the secondary Create transaction an Edit template offers.
// The secondary sits above the primary, like the account detail footer's two buttons.
const FormFooter = ({
  onSave,
  isSubmitting,
  onCreateTransaction,
}: FormFooterProps): ReactElement => {
  const { t } = useTranslation();

  const saveButton = (
    <Button onPress={onSave} disabled={isSubmitting}>
      {t('common.save')}
    </Button>
  );

  if (onCreateTransaction === undefined) {
    return saveButton;
  }

  return (
    <Box gap={2}>
      <Button
        variant="secondaryTonal"
        onPress={onCreateTransaction}
        icon={genericEntitySymbol.transaction}
      >
        {t('forms.transaction.createTransaction')}
      </Button>
      {saveButton}
    </Box>
  );
};

export default FormFooter;
