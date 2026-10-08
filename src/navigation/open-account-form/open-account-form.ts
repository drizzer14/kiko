import type { NavigationProp } from '@react-navigation/native';

import type { TabParamList } from '../types';

// One navigate with the whole target: a second navigate right after the first
// replaces the tab's nested params before the stack has read them. `initial:
// false` keeps the Accounts root below the form when the tab was never opened,
// and a stack that is deeper keeps its pages, so Back always lands on one.
// Only `navigate` is asked for: a screen's composite (stack plus tab) prop
// answers it, but is not a whole tab navigator prop.
export const openAccountForm = (
  navigation: Pick<NavigationProp<TabParamList>, 'navigate'>,
): void => {
  navigation.navigate('AccountsTab', { screen: 'AccountForm', params: {}, initial: false });
};
