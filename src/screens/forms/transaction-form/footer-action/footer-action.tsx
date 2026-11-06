import type { TFunction } from 'i18next';
import type { ReactElement } from 'react';
import Button from '@kiko/design-system/components/button';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';

// The form's lone secondary footer action (Save is the nav bar's, like every other form's), as a
// builder rather than a component because `Screen` shows an empty footer slot for any non-
// undefined `footer`. A template edit's "Create transaction" opens the template as it is STORED:
// the unsaved edits on the form are neither used nor saved. "Convert to exchange" needs an
// existing row, so the two never meet.
export const footerActionOf = ({
  editTemplateId,
  convertEligible,
  converting,
  onCreateTransaction,
  onConvert,
  t,
}: {
  editTemplateId: string | null;
  convertEligible: boolean;
  converting: boolean;
  onCreateTransaction: (templateId: string) => void;
  onConvert: () => void;
  t: TFunction;
}): ReactElement | undefined => {
  if (editTemplateId !== null) {
    return (
      <Button
        variant="secondaryTonal"
        onPress={() => onCreateTransaction(editTemplateId)}
        icon={genericEntitySymbol.transaction}
      >
        {t('forms.transaction.createTransaction')}
      </Button>
    );
  }

  if (convertEligible && !converting) {
    return (
      <Button variant="secondaryTonal" onPress={onConvert} icon="arrow.left.arrow.right">
        {t('forms.transaction.convertToExchange')}
      </Button>
    );
  }

  return undefined;
};
