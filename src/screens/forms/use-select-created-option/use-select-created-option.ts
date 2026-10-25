import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';

import { closeHandback, type HandbackId, openHandback } from './created-option-handback';

// Selects the option the user created through an empty picker's "Add ..." row (a holding or a
// template). The returned function opens a handback and returns its id, which the caller passes to
// the create form; call it when the row is pressed. It returns `undefined` while a handback is
// already open, so a second press pushes nothing. When the create form saves, it hands its option
// id back to that id. Once the picker's screen regains focus, exactly that option is handed to
// `onSelect`, once, as soon as it is among `options`. A cancel hands back nothing, so nothing is
// selected, whatever other options appeared meanwhile. Focus is read from the screen's own
// navigation, because the new option can reach this field before or after the focus event. Outside
// a navigator (only a test renders the field that way) no focus arrives, so nothing is selected.
export const useSelectCreatedOption = (
  options: readonly { id: string }[],
  onSelect: (id: string) => void,
): (() => HandbackId | undefined) => {
  const navigation = useContext(NavigationContext);
  const openId = useRef<HandbackId | undefined>(undefined);
  const [awaitedId, setAwaitedId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const stopFocus = navigation?.addListener('focus', () => {
      if (openId.current !== undefined) {
        const handedBack = closeHandback(openId.current);

        openId.current = undefined;
        setAwaitedId(handedBack);
      }
    });
    // An id that never showed up (deleted meanwhile) must not select on a later visit.
    const stopBlur = navigation?.addListener('blur', () => setAwaitedId(undefined));

    return () => {
      stopFocus?.();
      stopBlur?.();
    };
  }, [navigation]);

  useEffect(
    () => () => {
      if (openId.current !== undefined) {
        closeHandback(openId.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (awaitedId !== undefined && options.some((option) => option.id === awaitedId)) {
      setAwaitedId(undefined);
      onSelect(awaitedId);
    }
  }, [options, awaitedId, onSelect]);

  return () => {
    if (openId.current !== undefined) {
      return undefined;
    }

    openId.current = openHandback();

    return openId.current;
  };
};
