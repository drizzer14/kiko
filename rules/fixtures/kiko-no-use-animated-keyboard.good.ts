import { useEffect } from 'react';
import { Keyboard } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

// Semgrep fixture (NEGATIVE): drives keyboard height off RN core `Keyboard`
// events, the same shape `bottom-sheet.component.tsx` uses, instead of the
// banned `useAnimatedKeyboard()`. A comment merely NAMING the banned hook
// (like this one mentioning useAnimatedKeyboard) must not match
// `kiko-no-use-animated-keyboard`.
export const useKeyboardHeight = () => {
  const keyboardHeight = useSharedValue(0);

  useEffect(() => {
    const willChange = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      keyboardHeight.value = withTiming(event.endCoordinates.height, {
        duration: event.duration ?? 250,
      });
    });
    const willHide = Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeight.value = withTiming(0, { duration: 250 });
    });

    return () => {
      willChange.remove();
      willHide.remove();
    };
  }, [keyboardHeight]);

  return keyboardHeight;
};
