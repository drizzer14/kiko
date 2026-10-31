import { isValidElement, type ReactElement, type ReactNode } from 'react';

type Options = { presentation?: string };

type OptionsOrFunction = Options | ((args: { route: { params: unknown } }) => Options);

type NavigatorElement = ReactElement<{
  screenOptions?: OptionsOrFunction;
  children: unknown;
}>;

// A `Stack.Screen` has a `name`; a `Stack.Group` or a fragment has none and holds more
// registrations, and a group's `screenOptions` apply to every screen inside it.
type RegistrationProps = {
  name?: string;
  options?: OptionsOrFunction;
  screenOptions?: OptionsOrFunction;
  children?: unknown;
};

type Registration = [name: string, presentation: string | undefined];

const resolved = (options: OptionsOrFunction | undefined, params: object): Options | undefined =>
  typeof options === 'function' ? options({ route: { params } }) : options;

const registrationsIn = (
  children: unknown,
  inherited: string | undefined,
  params: object,
): Registration[] =>
  [children].flat(Number.POSITIVE_INFINITY).flatMap((child): Registration[] => {
    if (!isValidElement<RegistrationProps>(child)) {
      return [];
    }

    const { name, options, screenOptions, children: nested } = child.props;

    if (name !== undefined) {
      return [[name, resolved(options, params)?.presentation ?? inherited]];
    }

    return registrationsIn(
      nested,
      resolved(screenOptions, params)?.presentation ?? inherited,
      params,
    );
  });

/**
 * Test helper: the registrations of a rendered pane-stack navigator (the navigator itself counts
 * as `<navigator>`) whose resolved options set a `presentation` other than the default push, as
 * `name:presentation`. It looks inside a `Stack.Group` or a fragment, and a group's
 * `screenOptions` count for its screens. A pane's stack reads `FixedContentMarginContext`, which
 * a modal presented from it would inherit, so every pane-stack screen must stay a push. An
 * options function is resolved with `params` as its route's params.
 */
export const nonPushPresentations = (
  rendered: ReactNode | Promise<ReactNode>,
  params: object = {},
): string[] => {
  const { props } = rendered as NavigatorElement;
  const registrations: Registration[] = [
    ['<navigator>', resolved(props.screenOptions, params)?.presentation],
    ...registrationsIn(props.children, undefined, params),
  ];

  return registrations
    .filter(([, presentation]) => presentation !== undefined && presentation !== 'card')
    .map(([name, presentation]) => `${name}:${presentation}`);
};
