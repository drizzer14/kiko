import Text from '../../src/design-system/components/text';
import FieldError from '../../src/design-system/components/field-error';

// Semgrep fixture (NEGATIVE): the real `FieldError` component, plus a
// `variant="body"` status line (not a validation-failure caption at all) —
// `kiko-no-raw-field-error-text` MUST report nothing here.

export const usesFieldError = <FieldError message="No file selected." />;

export const statusLine = <Text variant="body">Import complete.</Text>;
