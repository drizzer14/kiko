import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import InfoHint from '@kiko/design-system/components/info-hint';
import SelectField from '@kiko/design-system/components/select-field';
import { useSelectCreatedOption } from '@kiko/screens/forms/use-select-created-option';

import type { TemplateSelectProps } from './template-select.props';

// The Template tab's picker: a thin wrapper over the shared `SelectField`, like `ModeSelectField`.
// Its options are the template ids, shown by name. With no template stored it still shows, with a
// hint under it saying how one is made and an "Add template" row in its sheet that opens the
// new-template form, so the tab is never a dead end; the template that form saves is picked
// through `onSelect`. The hint and the row wait for the list read to settle, so neither flashes
// while that read is still queued.
const TemplateSelect = ({
  templates,
  isLoading,
  selectedId,
  onSelect,
  onCreateTemplate,
}: TemplateSelectProps): ReactElement => {
  const { t } = useTranslation();
  const startCreateRoundTrip = useSelectCreatedOption(templates, onSelect);
  const labels = Object.fromEntries(templates.map((template) => [template.id, template.name]));

  const handleCreateTemplate = (): void => {
    const handbackId = startCreateRoundTrip();

    if (handbackId !== undefined) {
      onCreateTemplate(handbackId);
    }
  };

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
        emptyAction={
          isLoading
            ? undefined
            : { label: t('forms.transaction.addTemplate'), onPress: handleCreateTemplate }
        }
        testID="template-field"
      />

      {!isLoading && templates.length === 0 ? (
        <InfoHint message={t('forms.transaction.noTemplatesHint')} />
      ) : null}
    </Box>
  );
};

export default TemplateSelect;
