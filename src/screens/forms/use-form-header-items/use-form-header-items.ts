import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export type FormHeaderItemsOptions = Pick<
  NativeStackNavigationOptions,
  'unstable_headerLeftItems' | 'unstable_headerRightItems'
>;

type FormHeaderItemsParams = {
  navigation: { goBack: () => void; setOptions: (options: FormHeaderItemsOptions) => void };
  onSave: () => void;
  // Whether the form has anything to save; a read-only form keeps only its Cancel.
  hasSave: boolean;
  isSaving: boolean;
};

/**
 * The nav-bar pair of a form: Cancel leading and a prominent Save trailing (HIG sheets: always
 * pair them). Cancel shows only where the stack draws no back button, because a back button
 * already closes the form; native-stack reports that through `canGoBack` of the screen's own
 * pane, which `navigation.canGoBack()` cannot (it sees the other pane's routes too).
 */
export const useFormHeaderItems = ({
  navigation,
  onSave,
  hasSave,
  isSaving,
}: FormHeaderItemsParams): void => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const latestSave = useRef(onSave);

  // `save` is a new function on every render; registering it directly would register the header
  // on every render too, so the header keeps one press handler that reads the latest save.
  useEffect(() => {
    latestSave.current = onSave;
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerLeftItems: ({ canGoBack }) =>
        canGoBack === true
          ? []
          : [
              {
                type: 'button',
                label: t('common.cancel'),
                accessibilityLabel: t('common.cancel'),
                variant: 'plain',
                tintColor: theme.colors.textPrimary,
                onPress: () => navigation.goBack(),
              },
            ],
      unstable_headerRightItems: () =>
        hasSave
          ? [
              {
                type: 'button',
                label: t('common.save'),
                accessibilityLabel: t('common.save'),
                variant: 'prominent',
                tintColor: theme.colors.accent,
                sharesBackground: false,
                disabled: isSaving,
                onPress: () => latestSave.current(),
              },
            ]
          : [],
    });
  }, [navigation, t, theme.colors.textPrimary, theme.colors.accent, hasSave, isSaving]);
};
