import type { NavigationProp } from '@react-navigation/native';

import type { TabParamList } from '../types';

// One navigate with the whole target: a second navigate right after the first
// replaces the tab's nested params before the stack has read them. `initial:
// false` keeps the Accounts root below the form when the tab was never opened,
// and a stack that is deeper keeps its pages, so Back always lands on one.
export const openAccountForm = (navigation: NavigationProp<TabParamList>): void => {
  navigation.navigate('AccountsTab', { screen: 'AccountForm', params: {}, initial: false });
};
