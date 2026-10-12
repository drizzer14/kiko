import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@kiko/design-system/components/button';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';

import type { FormFooterProps } from './form-footer.props';

// The Edit template form's pinned footer: only the secondary Create transaction. Save is the nav
// bar's, like every other form's.
const FormFooter = ({ onCreateTransaction }: FormFooterProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <Button
      variant="secondaryTonal"
      onPress={onCreateTransaction}
      icon={genericEntitySymbol.transaction}
    >
      {t('forms.transaction.createTransaction')}
    </Button>
  );
};

export default FormFooter;
