import { i18n } from '@kiko/i18n/init';
import type { ComponentProps } from 'react';
import { calendarMonthOf } from '@kiko/dates';
import { render } from '@testing-library/react-native';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { answerFilterData } from '@kiko/test-support/statistics-filter-data';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TablesScreen from '../tables.screen';
import { monthTitle } from '../month-column-label';

type Props = ComponentProps<typeof TablesScreen>;

export const SPENT_AT = localDaysFrom(Date.now(), -2);
export const SPENT_IN = monthTitle(calendarMonthOf(SPENT_AT), i18n.t);

export const answerWith =
  (override: (tables: string[], answer: ReturnType<typeof answerFilterData>) => unknown) =>
  (query: { kind?: string }, tables: string[]) => {
    const answer = answerFilterData(query, tables);

    return { ...answer, data: override(tables, answer) ?? answer.data };
  };

export const screenElement = (params: Props['route']['params'], navigation = navigationSpy()) => (
  <TablesScreen
    route={asRouteProp<Props['route']>('Tables', params)}
    navigation={asNavigationProp<Props['navigation']>(navigation)}
  />
);

export const renderTables = async (params: Props['route']['params'] = undefined) => {
  const navigation = navigationSpy();
  const rendered = await render(screenElement(params, navigation), {
    wrapper: GestureRootWrapper,
  });

  return { navigation, ...rendered };
};

export const spokenValue = (node: { props: { accessibilityValue?: { text?: string } } }) =>
  node.props.accessibilityValue?.text;
