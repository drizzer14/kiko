// Semgrep fixture (NEGATIVE): kiko-architecture's "Pane navigation". Nothing here reads focus, so
// `kiko-no-focus-hook-in-pane-default-screen` (and every other rule) MUST report zero findings.
import { useEffect } from 'react';
import {
  type useFocusEffect as EffectHook,
  type useIsFocused as FocusHook,
} from '@react-navigation/native';
import * as Navigation from '@react-navigation/native';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';

// An inline `type` on the specifier erases the import; it loads no hook.
export type ScreenFocus = typeof FocusHook;

// A `typeof` of such an alias outside a `type` declaration is a type position too: Semgrep
// resolves the alias to the hook, so the rule leaves every `typeof` alone.
export const describeFocus = (hook: typeof FocusHook) => hook.name;

let storedEffect: typeof EffectHook | undefined;

// A test double replaces the hook; the cast calls nothing.
export const mockedEffect = Navigation.useFocusEffect as jest.Mock;

// An inline `type` on the specifier erases it the same way. This is a re-export, not an import,
// because a second import of the module above would break the one-declaration-per-module rule.
export {
  type useFocusEffect as InlineEffectHook,
  type useIsFocused as InlineFocusHook,
} from '@react-navigation/native';

export const PausesOnVisibility = () => {
  const isVisible = useIsScreenVisible();

  useEffect(() => {
    if (isVisible) {
      return;
    }
  }, [isVisible]);

  // Prose and a mock key name the hook without calling it.
  const description = 'useIsFocused and useFocusEffect never run in a default';
  const mock = { useIsFocused: () => false };

  return [isVisible, description, mock];
};
