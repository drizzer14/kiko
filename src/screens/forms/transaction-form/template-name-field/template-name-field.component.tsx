import { View } from 'react-native';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import TextField from '@kiko/design-system/components/text-field';

import type { TemplateNameFieldProps } from './template-name-field.props';

// The template's name field, used by both template modes and by the "save as a template" switch.
// Its error (empty, or taken) sits under it through `TextField`'s own `error`. Wrapped in a plain
// `View` for `fieldRef`, so a blocked Save can scroll to it. Returns null while `visible` is false,
// so the screen gates on one element instead of its own `&&`.
const TemplateNameField = ({
  visible,
  value,
  onChangeText,
  error,
  fieldRef,
  inputRef,
}: TemplateNameFieldProps): ReactElement | null => {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <View ref={fieldRef}>
      <TextField
        label={t('forms.transaction.templateName')}
        value={value}
        onChangeText={onChangeText}
        placeholder={t('forms.transaction.templateNamePlaceholder')}
        required
        error={error}
        inputRef={inputRef}
      />
    </View>
  );
};

export default TemplateNameField;
