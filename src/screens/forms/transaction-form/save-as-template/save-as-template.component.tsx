import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from '@kiko/design-system/components/switch';

import TemplateNameField from '../template-name-field';

import type { SaveAsTemplateProps } from './save-as-template.props';

// The switch at the bottom of the Add, Duplicate and Edit forms that saves the transaction's
// fields as a template too, with the template's name field right below it while it is on. Both are
// direct children of the form's `Box`, so its gap spaces them like any other field. Returns null
// while `visible` is false, so the screen gates on one element instead of its own `&&`.
const SaveAsTemplate = ({
  visible,
  isOn,
  onToggle,
  name,
  onChangeName,
  error,
  nameFieldRef,
  nameInputRef,
}: SaveAsTemplateProps): ReactElement | null => {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <>
      <Switch label={t('forms.transaction.saveAsTemplate')} value={isOn} onValueChange={onToggle} />

      <TemplateNameField
        visible={isOn}
        value={name}
        onChangeText={onChangeName}
        error={error}
        fieldRef={nameFieldRef}
        inputRef={nameInputRef}
      />
    </>
  );
};

export default SaveAsTemplate;
