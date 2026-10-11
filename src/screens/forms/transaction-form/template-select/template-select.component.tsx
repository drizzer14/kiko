import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import InfoHint from '@kiko/design-system/components/info-hint';
import SelectField from '@kiko/design-system/components/select-field';

import type { TemplateSelectProps } from './template-select.props';

// The Template tab's picker: a thin wrapper over the shared `SelectField`, like `ModeSelectField`.
// Its options are the template ids, shown by name. With no template stored it still shows, with a
// hint under it saying how one is made, so the tab is never a dead end.
const TemplateSelect = ({ templates, selectedId, onSelect }: TemplateSelectProps): ReactElement => {
  const { t } = useTranslation();
  const labels = Object.fromEntries(templates.map((template) => [template.id, template.name]));

  return (
    <Box gap={1}>
      <SelectField
        label={t('forms.transaction.template')}
        sheetTitle={t('forms.transaction.templateSheetTitle')}
        options={templates.map((template) => template.id)}
        selected={selectedId}
        onSelect={onSelect}
        labels={labels}
        placeholder={t('forms.transaction.selectTemplate')}
        testID="template-field"
      />

      {templates.length === 0 ? (
        <InfoHint message={t('forms.transaction.noTemplatesHint')} />
      ) : null}
    </Box>
  );
};

export default TemplateSelect;
