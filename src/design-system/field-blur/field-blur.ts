import { createContext, useContext } from 'react';
import type { TextInputProps } from 'react-native';

/**
 * Told whenever a text field inside a `Screen` loses focus. A form that keeps a draft of its
 * fields listens, so it need not pass a blur handler through every field it renders. Absent
 * (undefined) where nothing listens, so a field outside such a form keeps the handler it was
 * given, or none.
 */
export const FieldBlurContext = createContext<(() => void) | undefined>(undefined);

/**
 * The blur handler a text input takes: its own, then the listening form's. The form hears the
 * blur after the field's own handler has queued its state changes, so a draft saved after the
 * commit includes them.
 */
export const useFieldBlur = (own: TextInputProps['onBlur']): TextInputProps['onBlur'] => {
  const notify = useContext(FieldBlurContext);

  if (notify === undefined) {
    return own;
  }

  return (event) => {
    own?.(event);
    notify();
  };
};
