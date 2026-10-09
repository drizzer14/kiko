import { match, P } from 'ts-pattern';
import { CommonActions, StackActions } from '@react-navigation/native';

import { PaneActions, type PaneActionType } from '../pane-router';

// The action each helper a navigation object has builds, by its name.
const ACTION_CREATORS: Record<string, (...args: never[]) => unknown> = {
  ...CommonActions,
  ...StackActions,
  ...PaneActions,
};

type OpeningAction = { type: string; payload?: { name?: string; params?: object } };

const doNothing = () => undefined;

/**
 * Lets a screen shown as a default navigate. React Navigation gives every screen it renders
 * without a route in the state one shared navigation object whose every helper throws, and a
 * tap in a default screen would reach it. Here a navigate or push opens its route in the pane
 * opposite the default, and everything else is ignored: a default has nothing to go back to.
 *
 * The object is changed in place because the rendered screen already holds it. At most one
 * default is on screen at a time, since the pane that holds the root is never empty.
 */
export const standInNavigation = <
  Descriptor extends { route: { key: string }; navigation: object },
>(
  descriptor: Descriptor,
  dispatch: (action: PaneActionType) => void,
): Descriptor => {
  const openerKey = descriptor.route.key;
  const send = (action: OpeningAction | ((state: never) => unknown)): void => {
    match(action)
      .with({ type: P.union('NAVIGATE', 'PUSH') }, ({ payload }) => {
        if (payload?.name !== undefined) {
          dispatch(PaneActions.open(openerKey, payload.name, payload.params));
        }
      })
      .otherwise(doNothing);
  };
  const helpers = Object.fromEntries(
    Object.entries(ACTION_CREATORS).map(([name, create]) => [
      name,
      (...args: never[]) => send(create(...args) as OpeningAction),
    ]),
  );

  Object.assign(descriptor.navigation, helpers, { dispatch: send, setOptions: doNothing });

  return descriptor;
};
